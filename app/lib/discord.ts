// Discord plumbing shared by the scheduled reports and /ask: webhook posting,
// embed size limits, and turning dashboard markdown into what Discord renders.
//
// Channels are private (approved 2026-10-13) and every webhook URL is a
// server-only env var, so a leaked link is replaced in Discord in a minute
// and nothing in the browser bundle ever knows one.

export const BOT_NAME = "Standard Creative Dashboard";

// Discord's hard limits. Over any of them the whole message is refused.
const LIMIT = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, fields: 25, total: 6000, embeds: 10 };

export const COLOR = { blue: 0x1a5fc8, green: 0x199e70, orange: 0xd95926, grey: 0x5b6475 };

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: EmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordMessage {
  content?: string;
  embeds: Embed[];
}

const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

// Trim every piece to its limit, then drop trailing fields until the embed
// fits the 6,000-character total. A long report loses its tail, never the post.
export function fitEmbed(e: Embed): Embed {
  const out: Embed = {
    ...e,
    title: e.title ? cut(e.title, LIMIT.title) : undefined,
    description: e.description ? cut(e.description, LIMIT.description) : undefined,
    fields: (e.fields ?? []).slice(0, LIMIT.fields).map((f) => ({
      ...f,
      name: cut(f.name || "\u200b", LIMIT.fieldName),
      value: cut(f.value || "\u200b", LIMIT.fieldValue),
    })),
  };
  const size = (x: Embed) =>
    (x.title?.length ?? 0) + (x.description?.length ?? 0) + (x.footer?.text.length ?? 0) +
    (x.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
  while (size(out) > LIMIT.total && out.fields && out.fields.length) out.fields.pop();
  return out;
}

export class DiscordError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DiscordError";
    this.status = status;
  }
}

// Which webhook a report goes to. DISCORD_WEBHOOK_TEST, when set, takes every
// report instead, which is how the one-week test in a private channel runs.
export type Channel = "daily" | "leads";
export function webhookFor(channel: Channel): { url: string | null; test: boolean } {
  const test = process.env.DISCORD_WEBHOOK_TEST?.trim();
  if (test) return { url: test, test: true };
  const url = channel === "daily" ? process.env.DISCORD_WEBHOOK_DAILY_REPORT : process.env.DISCORD_WEBHOOK_CREATIVE_LEADS;
  return { url: url?.trim() || null, test: false };
}

export async function postWebhook(url: string, msg: DiscordMessage): Promise<{ id: string | null }> {
  if (!/^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\//.test(url)) {
    throw new DiscordError("That isn't a Discord webhook URL.", 400);
  }
  const res = await fetch(`${url}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: BOT_NAME,
      content: msg.content,
      embeds: msg.embeds.slice(0, LIMIT.embeds).map(fitEmbed),
      allowed_mentions: { parse: [] },   // a brief named "@everyone …" must not ping the server
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 404 || res.status === 401) {
      throw new DiscordError("Discord says the webhook doesn't exist. It was probably deleted or regenerated; paste the new URL into Vercel.", res.status);
    }
    throw new DiscordError(`Discord refused the message (HTTP ${res.status}): ${text.slice(0, 300)}`, res.status);
  }
  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  return { id: body?.id ?? null };
}

// ---- Formatting helpers --------------------------------------------------------

export function usd(n: number, decimals = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function ratio(n: number | null): string {
  return n == null ? "–" : n.toFixed(2);
}

export function pctChange(now: number, before: number): number | null {
  return before > 0 ? (now - before) / before : null;
}

// "▲ 14%" / "▼ 9%" — direction plus magnitude, no colour (Discord embeds have none).
export function delta(now: number, before: number): string {
  const p = pctChange(now, before);
  if (p == null) return "";
  return `${p >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(p * 100))}%`;
}

// 5/10/2026 — day/month/year, the way the team writes dates (PH and AU).
export function dmy(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d}/${m}/${y}`;
}

export function dm(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d}/${m}`;
}

export function weekday(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

// Escape the characters Discord markdown would act on in a free-text name.
export function plain(s: string): string {
  return s.replace(/([*_~`|>\\])/g, "\\$1").replace(/@/g, "@\u200b");
}

// Monospace table for a code block — Discord embeds can't render real tables.
export function monoTable(header: string[], rows: (string | number)[][], align: ("l" | "r")[]): string {
  const cells = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, i) => Math.max(...cells.map((r) => (r[i] ?? "").length)));
  const line = (r: string[]) => r.map((c, i) => (align[i] === "r" ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ").trimEnd();
  return ["```", line(header), widths.map((w) => "─".repeat(w)).join("  "), ...cells.slice(1).map(line), "```"].join("\n");
}

// Ask AI writes for the dashboard's renderer. Discord has no tables, images or
// charts, so tables become code blocks, images become links, charts are dropped.
export function markdownForDiscord(md: string): string {
  let text = md.replace(/```chart[\s\S]*?```/g, "_(chart available in the dashboard's Ask AI)_");
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => `[${alt || "image"}](${url})`);
  // The thin-evidence mark becomes "*" inside tables (see fitTable), so the
  // prose that explains it has to say "*" too.
  text = text.replace(/⚠️?/g, "*");

  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const isRow = (l: string | undefined) => !!l && /^\s*\|.*\|\s*$/.test(l);
    if (isRow(lines[i]) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const rows: string[][] = [];
      while (isRow(lines[i])) {
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) {
          // Code blocks don't render markdown, so drop bold/italic markers.
          rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) =>
            c.trim().replace(/\*\*/g, "").replace(/^\*(.+)\*$/, "$1").replace(/^_(.+)_$/, "$1")));
        }
        i++;
      }
      i--;
      const [head, ...body] = rows;
      const numeric = head.map((_, c) => body.length > 0 && body.every((r) => /^[-$€£▲▼+]?[\d.,]+[%kKmMx]?$|^–$/.test(r[c] ?? "")));
      out.push(fitTable(head, body, numeric.map((n) => (n ? "r" : "l"))));
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// A code block wider than the embed wraps every row onto two lines (~58 chars
// on desktop). Emoji are wider than a monospace cell and knock the columns out
// of line, so they become "*". Then the label column is cut to LABEL_MAX, and
// if it's still too wide the other columns are split across several tables,
// each repeating the label, rather than dropping any data.
const TABLE_MAX = 52;
const LABEL_MAX = 22;

function fitTable(head: string[], body: string[][], align: ("l" | "r")[]): string {
  const clean = (s: string) => s.replace(/\p{Extended_Pictographic}️?/gu, "*").replace(/\s+\*/g, " *").trim();
  // Keep a trailing "*" mark when the label is cut, or the cut hides it.
  const cut = (s: string) => {
    if (s.length <= LABEL_MAX) return s;
    const mark = s.endsWith(" *") ? " *" : "";
    const base = mark ? s.slice(0, -2) : s;
    return base.slice(0, LABEL_MAX - 1 - mark.length).trimEnd() + "…" + mark;
  };
  const rows = body.map((r) => head.map((_, c) => clean(r[c] ?? "")));
  const header = head.map(clean);
  for (const r of [header, ...rows]) r[0] = cut(r[0]);

  const width = (c: number) => Math.max(...[header, ...rows].map((r) => r[c].length));
  const groups: number[][] = [];
  let cur: number[] = [];
  let used = width(0);
  for (let c = 1; c < header.length; c++) {
    const w = width(c) + 2;
    if (cur.length && used + w > TABLE_MAX) {
      groups.push(cur);
      cur = [];
      used = width(0);
    }
    cur.push(c);
    used += w;
  }
  if (cur.length || !groups.length) groups.push(cur);

  return groups
    .map((g) => {
      const cols = [0, ...g];
      return monoTable(cols.map((c) => header[c]), rows.map((r) => cols.map((c) => r[c])), cols.map((c) => align[c]));
    })
    .join("\n");
}

// Split long text into embed-description-sized chunks on paragraph breaks,
// never inside a code block.
export function chunkText(text: string, size = 3900): string[] {
  const parts = text.split(/\n\n/);
  const chunks: string[] = [];
  let cur = "";
  let inCode = false;
  for (const p of parts) {
    const next = cur ? `${cur}\n\n${p}` : p;
    const fences = (p.match(/```/g) ?? []).length;
    if (next.length > size && cur && !inCode) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = next;
    }
    if (fences % 2 === 1) inCode = !inCode;
  }
  if (cur) chunks.push(cur);
  return chunks.flatMap((c) => (c.length > size ? [c.slice(0, size - 1) + "…"] : [c]));
}

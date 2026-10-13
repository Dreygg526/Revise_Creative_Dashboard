import { NextResponse, after } from "next/server";
import { createPublicKey, verify } from "node:crypto";
import { serviceClient } from "@/app/lib/apiAuth";
import { askDashboard } from "@/app/lib/askDashboard";
import { BOT_NAME, COLOR, chunkText, markdownForDiscord, type Embed } from "@/app/lib/discord";

// Discord's interactions endpoint: /ask <question> in the team's private
// #ask-ai channel runs the same Ask AI as the dashboard, read-only (approved
// 2026-10-13). Set it in the Discord Developer Portal → the app → General
// Information → Interactions Endpoint URL:
//   https://revise-creative-dashboard.vercel.app/api/discord/interactions
//
// Discord can't tell us which team member is asking, so nothing here writes:
// askDashboard runs with readOnly and has no propose_changes tool at all.
//
// Discord wants an answer within 3 seconds; an Ask AI run takes 15–60. So we
// reply "thinking…" (deferred) at once and post the answer afterwards with
// after(), which keeps the function alive up to maxDuration.
export const runtime = "nodejs";
export const maxDuration = 300;

const API = "https://discord.com/api/v10";
const DAILY_CAP = Number(process.env.DISCORD_ASK_DAILY_CAP || 25);

// Ed25519 public key from the portal, as hex. The DER prefix turns the raw
// 32 bytes into an SPKI key node:crypto can verify with.
function publicKey() {
  const hex = (process.env.DISCORD_PUBLIC_KEY || "").trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return createPublicKey({ key: Buffer.from("302a300506032b6570032100" + hex, "hex"), format: "der", type: "spki" });
}

function signatureOk(body: string, sig: string | null, ts: string | null): boolean {
  const key = publicKey();
  if (!key || !sig || !ts || !/^[0-9a-f]{128}$/i.test(sig)) return false;
  try {
    return verify(null, Buffer.from(ts + body), key, Buffer.from(sig, "hex"));
  } catch {
    return false;
  }
}

const allowed = (envVar: string, id: string | undefined) => {
  const list = (process.env[envVar] || "").split(",").map((s) => s.trim()).filter(Boolean);
  return !list.length || (!!id && list.includes(id));
};

const ephemeral = (content: string) => NextResponse.json({ type: 4, data: { content, flags: 64 } });

interface Interaction {
  type: number;
  token: string;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  member?: { nick?: string | null; user?: DiscordUser };
  user?: DiscordUser;
  data?: { name?: string; options?: { name: string; value: unknown }[] };
}
interface DiscordUser { id: string; username: string; global_name?: string | null }

export async function POST(req: Request) {
  // Discord checks this endpoint with deliberately bad signatures before it
  // will save it; anything unsigned gets a 401 and nothing else.
  const body = await req.text();
  if (!signatureOk(body, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"))) {
    return new NextResponse("Bad signature.", { status: 401 });
  }

  const ix = JSON.parse(body) as Interaction;
  if (ix.type === 1) return NextResponse.json({ type: 1 });   // PING
  if (ix.type !== 2 || ix.data?.name !== "ask") return ephemeral("I only know /ask.");

  if (!allowed("DISCORD_GUILD_IDS", ix.guild_id)) return ephemeral("This bot only answers in the team's server.");
  if (!allowed("DISCORD_ASK_CHANNEL_IDS", ix.channel_id)) return ephemeral("Ask in the #ask-ai channel, please.");

  const question = String(ix.data.options?.find((o) => o.name === "question")?.value ?? "").trim().slice(0, 2000);
  if (!question) return ephemeral("Add a question after /ask.");

  const user = ix.member?.user ?? ix.user;
  const name = ix.member?.nick || user?.global_name || user?.username || "someone";
  const admin = serviceClient();
  if (!admin || !process.env.ANTHROPIC_API_KEY) return ephemeral("The dashboard isn't configured for this yet (server keys missing).");

  // Per-person daily cap, counted in discord_ask_log. No table = no cap.
  if (user?.id && DAILY_CAP > 0) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count, error } = await admin
      .from("discord_ask_log")
      .select("id", { count: "exact", head: true })
      .eq("discord_user", user.id)
      .gte("asked_at", since);
    if (!error && (count ?? 0) >= DAILY_CAP) {
      return ephemeral(`You've hit today's limit of ${DAILY_CAP} questions here. Ask AI in the dashboard has no limit.`);
    }
  }

  after(() => answer(ix, question, name, user?.id ?? "unknown"));
  return NextResponse.json({ type: 5 });   // "Standard Creative Dashboard is thinking…"
}

async function answer(ix: Interaction, question: string, name: string, userId: string) {
  const admin = serviceClient()!;
  const started = Date.now();
  let text = "";
  let usage: { cost_usd: number; tool_calls: number } | null = null;
  let failed: string | null = null;

  try {
    await askDashboard(
      admin,
      [{ role: "user", content: question }],
      (e) => {
        if (e.type === "answer") { text = e.text; usage = e.usage; }
        if (e.type === "error") failed = e.error;
      },
      { user: { email: `discord:${userId}`, role: null, name }, autoApprove: false, readOnly: true }
    );
  } catch (e) {
    failed = e instanceof Error ? e.message : "Something went wrong.";
  }

  const seconds = Math.round((Date.now() - started) / 1000);
  const u = usage as { cost_usd: number; tool_calls: number } | null;
  const footer = failed
    ? "Read-only in Discord."
    : `${u?.tool_calls ?? 0} lookup${u?.tool_calls === 1 ? "" : "s"} · ${seconds}s · read-only in Discord. To change a card, ask in the dashboard and approve it there.`;

  const quoted = `*${question.replace(/\*/g, "\\*").slice(0, 300)}*`;
  const chunks = failed ? [`${quoted}\n\nCouldn't answer: ${failed}`] : chunkText(`${quoted}\n\n${markdownForDiscord(text)}`);
  const embeds: Embed[] = chunks.slice(0, 4).map((c, i, all) => ({
    description: c,
    color: failed ? COLOR.orange : COLOR.blue,
    footer: i === all.length - 1 ? { text: footer } : undefined,
  }));

  const res = await fetch(`${API}/webhooks/${ix.application_id}/${ix.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds, allowed_mentions: { parse: [] } }),
  }).catch((e) => {
    console.error("[discord ask] follow-up failed", e);
    return null;
  });
  if (res && !res.ok) console.error("[discord ask] follow-up refused", res.status, await res.text().catch(() => ""));

  await admin.from("discord_ask_log").insert({
    discord_user: userId,
    display_name: name,
    channel_id: ix.channel_id ?? null,
    question,
    ok: !failed,
    cost_usd: u?.cost_usd ?? null,
    tool_calls: u?.tool_calls ?? null,
  });
}

// So a browser visit explains itself instead of 405-ing.
export function GET() {
  return NextResponse.json({ ok: true, endpoint: `${BOT_NAME} · Discord interactions`, configured: !!publicKey() });
}

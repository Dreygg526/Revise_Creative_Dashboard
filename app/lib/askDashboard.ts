// Server-only: "Ask the dashboard" — Opus 5.5 answering questions about the
// pipeline and its performance through tools.
//
// Every number the model quotes has to come out of a tool here. The tools
// read the ads table (service role) and Triple Whale. The one tool that
// writes, propose_changes, goes through askEdits.ts: the user's own
// permissions, the pipeline gates, and an approval card unless they turned
// confirmation off.
// Performance uses the same path as the monthly learnings report — Triple
// Whale per-ad rows → matchInsights() → summed per brief — so a figure in a
// chat answer reconciles with the report for the same window.

import Anthropic from "@anthropic-ai/sdk";
import type { BetaToolResultContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/index";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ad } from "@/app/types";
import { matchInsights, extractDtcVariant } from "@/app/lib/metaMatch";
import {
  fetchTripleWhaleAdsInRange,
  fetchTripleWhaleAccountDaily,
  fetchTripleWhaleByAccount,
  type LifetimeAdRow,
} from "@/app/lib/tripleWhale";
import { loadThresholds, yesterday } from "@/app/lib/monthlyLearningsRun";
import { createdMonth } from "@/app/lib/adDates";
import { randomUUID } from "node:crypto";
import { applyChanges, validateChanges, EDITABLE_FIELDS, type ChangeItem, type EditUser } from "@/app/lib/askEdits";
import { can } from "@/app/lib/permissions";

export const ASK_MODEL = "claude-opus-5-5";
const ALL_TIME_DAYS = 730; // same cap as the sync's "maximum"
const MAX_ITERATIONS = 14;

export type AskEvent =
  | { type: "tool"; label: string }
  | { type: "proposal"; id: string; summary: string; items: ChangeItem[]; errors: string[] }
  | { type: "applied"; id: string; summary: string; items: ChangeItem[]; errors: string[] }
  | { type: "answer"; text: string; usage: AskUsage; images: string[] }
  | { type: "error"; error: string };

export interface AskOptions {
  user: EditUser & { email: string };
  // The user ticked "skip confirmation": proposals are applied as soon as
  // they validate. Same validator, same permissions.
  autoApprove: boolean;
}

export interface AskUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  tool_calls: number;
}

// A file the user attached to a question: a screenshot, a competitor's ad, a
// PDF brief. Base64, already downscaled in the browser (Vercel caps a request
// body at 4.5MB, so the page keeps the total under ~3.5MB).
export interface ChatAttachment {
  name: string;
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf";
  data: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];   // user turns only
}

function turnContent(t: ChatTurn): Anthropic.Beta.BetaMessageParam["content"] {
  if (t.role !== "user" || !t.attachments?.length) return t.content;
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = t.attachments.map((a) =>
    a.media_type === "application/pdf"
      ? { type: "document", title: a.name, source: { type: "base64", media_type: "application/pdf", data: a.data } }
      : { type: "image", source: { type: "base64", media_type: a.media_type, data: a.data } }
  );
  const names = t.attachments.map((a) => a.name).join(", ");
  blocks.push({ type: "text", text: `${t.content}\n\n(Attached by the user: ${names})` });
  return blocks;
}

// ---------------------------------------------------------------------------
// Shared per-question state. One question can call several tools over the
// same window; the Triple Whale pull for a window happens once.
// ---------------------------------------------------------------------------

interface BriefPerf {
  spend: number;
  revenue: number;
  nc_revenue: number;
  purchases: number;
  nc_orders: number;
  meta_revenue: number;      // Meta's own attribution (Ads Manager / Moby), not the pixel
  meta_purchases: number;
  impressions: number;
  clicks: number;
  first_spend: string | null;
  metas: LifetimeAdRow[];
}

interface WindowData {
  start: string;
  end: string;
  byAd: Map<string, BriefPerf>;
  rows: LifetimeAdRow[];              // every Meta ad that spent in the window
  briefOfMeta: Map<string, string>;   // Meta ad id -> dashboard ads.id it rolls into
  unmatched: { ad_name: string; adset_name: string | null; spend: number; reason: string }[];
  totalSpend: number;
}

interface Ctx {
  admin: SupabaseClient;
  user: AskOptions["user"];
  autoApprove: boolean;
  emit: (e: AskEvent) => void;
  // Every image URL a tool handed the model. The page renders only these, so
  // a made-up URL in an answer shows as text, not as a broken or foreign image.
  images: Set<string>;
  ads: Ad[];
  asOf: string;
  rule: { minSpend: number; ncTarget: number };
  windows: Map<string, Promise<WindowData>>;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

// Names the team uses for the accounts it knows. Others show as their id.
const ACCOUNT_LABELS: Record<string, string> = {
  act_2223260745102430: "Ad Account 12345",
  act_1483472386914314: "Ad Account 7 (disabled)",
};
const accountLabel = (id: string | null) => (id ? ACCOUNT_LABELS[id] ?? id : null);

// "Ad Account 12345", "12345", "act_2223…" or the bare number -> act_ id.
function normalizeAccount(input?: string): string | null {
  if (!input?.trim()) return null;
  const t = input.trim();
  for (const [id, label] of Object.entries(ACCOUNT_LABELS)) {
    if (t.toLowerCase() === label.toLowerCase() || t.toLowerCase() === label.toLowerCase().replace(/ \(.*\)$/, "")) return id;
  }
  if (/^(ad account )?12345$/i.test(t)) return "act_2223260745102430";
  const digits = t.replace(/^act_/i, "").replace(/\D/g, "");
  if (digits.length >= 8) return `act_${digits}`;
  throw new Error(`Unknown ad account "${t}". Use spend_by_account to list them.`);
}

function resolveWindow(ctx: Ctx, start?: string, end?: string, account?: string) {
  const e = end && end < ctx.asOf ? end : ctx.asOf;
  const allStart = new Date(new Date(ctx.asOf).getTime() - ALL_TIME_DAYS * 86_400_000).toISOString().slice(0, 10);
  const s = start && start > allStart ? start : allStart;
  const acct = normalizeAccount(account);
  return { start: s, end: e, all_time: !start, account: acct, account_label: accountLabel(acct) };
}

// With an account, only that account's Meta ads count: a brief that ran in
// two accounts shows just its share in the one asked about.
function windowData(ctx: Ctx, w: { start: string; end: string; account: string | null }): Promise<WindowData> {
  const { start, end, account } = w;
  const key = `${start}|${end}|${account ?? "*"}`;
  let p = ctx.windows.get(key);
  if (!p) {
    p = (async () => {
      const all = await fetchTripleWhaleAdsInRange(start, end);
      const rows = account ? all.filter((r) => r.account_id === account) : all;
      const byMeta = new Map(rows.map((r) => [r.ad_id, r]));
      const { matches, unmatched } = matchInsights(rows, ctx.ads);
      const byAd = new Map<string, BriefPerf>();
      for (const m of matches) {
        const metas = m.metaAdIds.map((id) => byMeta.get(id)).filter((x): x is LifetimeAdRow => !!x);
        byAd.set(m.adId, {
          spend: m.spend,
          revenue: m.revenue,
          purchases: m.purchases,
          impressions: m.impressions,
          clicks: m.clicks,
          nc_revenue: metas.reduce((s, x) => s + x.nc_revenue, 0),
          nc_orders: metas.reduce((s, x) => s + x.nc_orders, 0),
          meta_revenue: metas.reduce((s, x) => s + x.meta_reported_revenue, 0),
          meta_purchases: metas.reduce((s, x) => s + x.meta_reported_purchases, 0),
          first_spend: metas.length ? metas.map((x) => x.first_spend).sort()[0] : null,
          metas,
        });
      }
      return {
        start,
        end,
        byAd,
        rows,
        briefOfMeta: new Map(matches.flatMap((m) => m.metaAdIds.map((id) => [id, m.adId] as [string, string]))),
        unmatched: unmatched
          .sort((a, b) => b.spend - a.spend)
          .map((u) => ({ ad_name: u.ad_name, adset_name: byMeta.get(u.ad_id)?.adset_name ?? null, spend: u.spend, reason: u.reason })),
        totalSpend: rows.reduce((s, r) => s + r.spend, 0),
      };
    })();
    ctx.windows.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Shaping helpers — round everything; the model doesn't need 14 decimals.
// ---------------------------------------------------------------------------

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
const r0 = (n: number) => Math.round(n);

function verdict(ctx: Ctx, p: BriefPerf | undefined) {
  if (!p || p.spend <= 0) return "No spend";
  if (p.spend < ctx.rule.minSpend) return "Too early";
  return (ratio(p.nc_revenue, p.spend) ?? 0) >= ctx.rule.ncTarget ? "Winner" : "Loser";
}

function perfOut(ctx: Ctx, p: BriefPerf | undefined) {
  if (!p || p.spend <= 0) return { spend: 0, verdict_by_rule: "No spend" };
  return {
    spend: r0(p.spend),
    nc_roas: r2(ratio(p.nc_revenue, p.spend)),
    roas: r2(ratio(p.revenue, p.spend)),
    cpa: r2(ratio(p.spend, p.purchases)),
    purchases: p.purchases,
    nc_orders: p.nc_orders,
    meta_reported_roas: r2(ratio(p.meta_revenue, p.spend)),
    meta_reported_purchases: p.meta_purchases,
    ctr_pct: r2(p.impressions > 0 ? (p.clicks / p.impressions) * 100 : null),
    cvr_pct: r2(p.clicks > 0 ? (p.purchases / p.clicks) * 100 : null),
    first_spend_in_window: p.first_spend,
    meta_ads: p.metas.length,
    verdict_by_rule: verdict(ctx, p),
  };
}

function briefOut(ctx: Ctx, ad: Ad, p: BriefPerf | undefined) {
  const thumb = p?.metas.slice().sort((a, b) => b.spend - a.spend).find((m) => m.image_url)?.image_url ?? ad.meta_ad_image_url;
  if (thumb) ctx.images.add(thumb);
  return {
    dtc: ad.dtc_number,
    name: ad.ad_name || "(untitled)",
    stage: ad.stage,
    product: ad.product,
    persona: ad.persona,
    problem: ad.problem,
    core_emotion: ad.core_emotion,
    awareness: ad.awareness,
    angle: ad.angle,
    concept: ad.concept,
    ad_type: ad.ad_type,
    format: ad.format,
    strategist: ad.assigned_strategist,
    editor: ad.assigned_editor,
    created: ad.created_at.slice(0, 10),
    result: ad.result,
    has_learning: !!ad.learning?.trim(),
    thumbnail: thumb ?? null,
    perf: perfOut(ctx, p),
  };
}

function totalsOf(ctx: Ctx, perfs: (BriefPerf | undefined)[]) {
  const ps = perfs.filter((p): p is BriefPerf => !!p && p.spend > 0);
  const spend = ps.reduce((s, p) => s + p.spend, 0);
  const nc = ps.reduce((s, p) => s + p.nc_revenue, 0);
  const rev = ps.reduce((s, p) => s + p.revenue, 0);
  const purchases = ps.reduce((s, p) => s + p.purchases, 0);
  const metaRev = ps.reduce((s, p) => s + p.meta_revenue, 0);
  const verdicts = perfs.map((p) => verdict(ctx, p));
  return {
    briefs_with_spend: ps.length,
    spend: r0(spend),
    nc_roas: r2(ratio(nc, spend)),
    roas: r2(ratio(rev, spend)),
    meta_reported_roas: r2(ratio(metaRev, spend)),
    cpa: r2(ratio(spend, purchases)),
    winners: verdicts.filter((v) => v === "Winner").length,
    losers: verdicts.filter((v) => v === "Loser").length,
    too_early: verdicts.filter((v) => v === "Too early").length,
  };
}

// ---------------------------------------------------------------------------
// Filters shared by search_briefs and compare_groups.
// ---------------------------------------------------------------------------

const TEXT_FIELDS = [
  "stage", "product", "persona", "sub_avatar", "problem", "core_emotion", "awareness",
  "angle", "concept", "format", "ad_type", "strategist", "editor",
] as const;

const FilterShape = {
  dtc_numbers: z.array(z.number().int()).optional().describe("Only these DTC numbers."),
  text: z.string().optional().describe("Case-insensitive search across name, angle, concept, hook, notes and learning."),
  ...Object.fromEntries(
    TEXT_FIELDS.map((f) => [f, z.string().optional().describe(`Case-insensitive substring match on ${f}.`)])
  ) as Record<(typeof TEXT_FIELDS)[number], z.ZodOptional<z.ZodString>>,
  result: z.enum(["Winner", "Killed", "none"]).optional().describe("The verdict stored on the card (rarely set — prefer verdict_by_rule)."),
  created_from: DATE.optional().describe("Card created on or after this date (UTC)."),
  created_to: DATE.optional().describe("Card created on or before this date (UTC)."),
  has_learning: z.boolean().optional(),
};

const WindowShape = {
  ad_account: z.string().optional().describe("Only count this Meta ad account: 'Ad Account 12345', an act_ id, or its number. Omit for all accounts (the default)."),
  start: DATE.optional().describe("Performance window start. Omit for all time (~2 years)."),
  end: DATE.optional().describe("Performance window end. Omit (or anything later) means yesterday."),
};

type Filters = z.infer<z.ZodObject<typeof FilterShape>>;

function fieldOf(ad: Ad, f: (typeof TEXT_FIELDS)[number]): string | null {
  if (f === "strategist") return ad.assigned_strategist;
  if (f === "editor") return ad.assigned_editor;
  return (ad as unknown as Record<string, string | null>)[f] ?? null;
}

function applyFilters(ads: Ad[], f: Filters): Ad[] {
  const has = (v: string | null | undefined, q: string) => !!v && v.toLowerCase().includes(q.toLowerCase());
  return ads.filter((ad) => {
    if (f.dtc_numbers?.length && (ad.dtc_number == null || !f.dtc_numbers.includes(ad.dtc_number))) return false;
    for (const field of TEXT_FIELDS) {
      const q = f[field];
      if (q && !has(fieldOf(ad, field), q)) return false;
    }
    if (f.text) {
      const hay = [ad.ad_name, ad.angle, ad.concept, ad.script_hook, ad.notes, ad.learning].filter(Boolean).join(" \n ");
      if (!has(hay, f.text)) return false;
    }
    if (f.result === "none" && ad.result) return false;
    if (f.result && f.result !== "none" && ad.result !== f.result) return false;
    const created = ad.created_at.slice(0, 10);
    if (f.created_from && created < f.created_from) return false;
    if (f.created_to && created > f.created_to) return false;
    if (f.has_learning != null && !!ad.learning?.trim() !== f.has_learning) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function buildTools(ctx: Ctx, onCall: (label: string) => void) {
  const json = (v: unknown) => JSON.stringify(v);

  const searchBriefs = betaZodTool({
    name: "search_briefs",
    description:
      "Find briefs (dashboard ad cards, one per DTC number) by tags, people, dates or text, with their Meta performance over a window. " +
      "Returns totals for everything that matched plus up to `limit` rows. Use this for lists, rankings ('top 10 by NC ROAS in September') and lookups by tag.",
    inputSchema: z.object({
      ...FilterShape,
      ...WindowShape,
      only_with_spend: z.boolean().optional().describe("Drop briefs with no spend in the window."),
      min_spend: z.number().optional().describe("Drop briefs below this spend. Use it when ranking by a ratio, so a $40 brief can't top the list."),
      sort_by: z.enum(["spend", "nc_roas", "roas", "cpa", "created", "dtc"]).optional().describe("Default spend."),
      ascending: z.boolean().optional(),
      limit: z.number().int().min(1).max(150).optional().describe("Default 40."),
    }),
    run: async (input) => {
      const w = resolveWindow(ctx, input.start, input.end, input.ad_account);
      onCall(`Searching briefs${describeFilters(input)} · ${describeWindow(w)}`);
      const data = await windowData(ctx, w);
      let rows = applyFilters(ctx.ads, input).map((ad) => ({ ad, p: data.byAd.get(ad.id) }));
      if (input.only_with_spend) rows = rows.filter((x) => (x.p?.spend ?? 0) > 0);
      if (input.min_spend != null) rows = rows.filter((x) => (x.p?.spend ?? 0) >= input.min_spend!);
      const key = input.sort_by ?? "spend";
      const val = (x: { ad: Ad; p?: BriefPerf }): number | string | null => {
        const p = x.p;
        switch (key) {
          case "spend": return p?.spend ?? 0;
          case "nc_roas": return p ? ratio(p.nc_revenue, p.spend) : null;
          case "roas": return p ? ratio(p.revenue, p.spend) : null;
          case "cpa": return p ? ratio(p.spend, p.purchases) : null;
          case "created": return x.ad.created_at;
          case "dtc": return x.ad.dtc_number;
        }
      };
      const asc = input.ascending ?? (key === "cpa" || key === "dtc");
      rows.sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;   // nulls last either way
        if (vb == null) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * (asc ? 1 : -1);
      });
      const limit = input.limit ?? 40;
      return json({
        window: w,
        rule: ctx.rule,
        matched: rows.length,
        totals: totalsOf(ctx, rows.map((x) => x.p)),
        showing: Math.min(limit, rows.length),
        briefs: rows.slice(0, limit).map((x) => briefOut(ctx, x.ad, x.p)),
      });
    },
  });

  const getBrief = betaZodTool({
    name: "get_brief",
    description:
      "Everything about one DTC number: all card fields (brief link, notes, hook, learning, selected copy, URLs, pages) plus performance over the window " +
      "and the individual Meta ads (creatives) behind it, with each one's spend and NC ROAS. Use it to explain why a brief won or lost.",
    inputSchema: z.object({
      dtc_number: z.number().int(),
      ...WindowShape,
      creatives_limit: z.number().int().min(1).max(100).optional().describe("Default 25, highest spend first."),
    }),
    run: async (input) => {
      const w = resolveWindow(ctx, input.start, input.end, input.ad_account);
      onCall(`Opening DTC #${input.dtc_number} · ${describeWindow(w)}`);
      const matches = ctx.ads.filter((a) => a.dtc_number === input.dtc_number);
      if (!matches.length) return json({ error: `No brief with DTC #${input.dtc_number} on the dashboard.` });
      const data = await windowData(ctx, w);
      return json({
        window: w,
        rule: ctx.rule,
        note: matches.length > 1 ? "Two cards share this DTC number; Meta spend attaches only to the first." : undefined,
        briefs: matches.map((ad) => {
          const p = data.byAd.get(ad.id);
          return {
            ...briefOut(ctx, ad, p),
            sub_avatar: ad.sub_avatar,
            priority: ad.priority,
            media_buyer: ad.assigned_media_buyer,
            due_date: ad.due_date,
            content_source: ad.content_source,
            script_hook: ad.script_hook,
            notes: ad.notes,
            learning: ad.learning,
            selected_headline: ad.selected_headline,
            selected_ad_copy: ad.selected_ad_copy,
            brief_link: ad.brief_link,
            frame_io_link: ad.frame_io_link,
            destination_urls: ad.destination_urls,
            whitelisting_pages: ad.whitelisting_pages,
            revision_count: ad.revision_count,
            creatives: (p?.metas ?? [])
              .slice()
              .sort((a, b) => b.spend - a.spend)
              .slice(0, input.creatives_limit ?? 25)
              .map((m) => {
                if (m.image_url) ctx.images.add(m.image_url);
                return {
                ad_name: m.ad_name,
                thumbnail: m.image_url,
                adset_name: m.adset_name,
                variant: extractDtcVariant(m.ad_name) ?? extractDtcVariant(m.adset_name),
                first_spend_in_window: m.first_spend,
                spend: r0(m.spend),
                nc_roas: r2(ratio(m.nc_revenue, m.spend)),
                roas: r2(ratio(m.revenue, m.spend)),
                cpa: r2(ratio(m.spend, m.purchases)),
                meta_ad_id: m.ad_id,
                meta_reported_roas: r2(ratio(m.meta_reported_revenue, m.spend)),
                meta_reported_purchases: m.meta_reported_purchases,
                ads_manager_url: adsManagerUrl(m.account_id, m.ad_id),
                ctr_pct: r2(m.impressions > 0 ? (m.clicks / m.impressions) * 100 : null),
                };
              }),
          };
        }),
      });
    },
  });

  const DIMENSIONS = [...TEXT_FIELDS, "created_month", "launch_month"] as const;

  const compareGroups = betaZodTool({
    name: "compare_groups",
    description:
      "Group briefs by one dimension (persona, problem, format, strategist, launch month, ...) and compare blended performance per group: " +
      "spend, NC ROAS, ROAS, CPA, winners/losers by the team's rule. Ratios are sum-over-sum, never averages. Groups with fewer than 3 judged briefs are flagged thin.",
    inputSchema: z.object({
      dimension: z.enum(DIMENSIONS).describe("launch_month = month of first spend inside the window; created_month = month the card was created (UTC)."),
      ...FilterShape,
      ...WindowShape,
    }),
    run: async (input) => {
      const w = resolveWindow(ctx, input.start, input.end, input.ad_account);
      onCall(`Comparing by ${input.dimension.replace("_", " ")}${describeFilters(input)} · ${describeWindow(w)}`);
      const data = await windowData(ctx, w);
      const buckets = new Map<string, { ad: Ad; p?: BriefPerf }[]>();
      for (const ad of applyFilters(ctx.ads, input)) {
        const p = data.byAd.get(ad.id);
        let key: string | null;
        if (input.dimension === "created_month") key = createdMonth(ad.created_at);
        else if (input.dimension === "launch_month") key = p?.first_spend?.slice(0, 7) ?? null;
        else key = fieldOf(ad, input.dimension)?.trim() || "(unassigned)";
        if (!key) continue; // launch_month: never spent in the window
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push({ ad, p });
      }
      const groups = [...buckets.entries()].map(([value, list]) => {
        const t = totalsOf(ctx, list.map((x) => x.p));
        const judged = t.winners + t.losers;
        return {
          value,
          briefs: list.length,
          ...t,
          win_rate_pct: judged ? r0((t.winners / judged) * 100) : null,
          thin: judged < 3,
        };
      });
      groups.sort((a, b) =>
        input.dimension.endsWith("_month") ? a.value.localeCompare(b.value) : b.spend - a.spend
      );
      return json({ window: w, rule: ctx.rule, dimension: input.dimension, groups });
    },
  });

  const accountTrend = betaZodTool({
    name: "account_trend",
    description:
      "Whole-account Meta performance over time (all six ad accounts, every ad, matched to a brief or not): spend, revenue, NC revenue, ROAS, NC ROAS, CPA, CTR per day/week/month. " +
      "Use it for 'how is the account doing', trends, and as the baseline a brief or group should be compared against.",
    inputSchema: z.object({
      ...WindowShape,
      granularity: z.enum(["day", "week", "month"]).optional().describe("Default: day up to 31 days, week up to 6 months, month beyond."),
    }),
    run: async (input) => {
      const w = resolveWindow(ctx, input.start ?? isoDaysAgo(ctx.asOf, 89), input.end, input.ad_account);
      const days = (new Date(w.end).getTime() - new Date(w.start).getTime()) / 86_400_000 + 1;
      const g = input.granularity ?? (days <= 31 ? "day" : days <= 183 ? "week" : "month");
      onCall(`Account trend by ${g} · ${describeWindow(w)}`);
      const series = await fetchTripleWhaleAccountDaily(w.start, w.end, w.account);
      const bucketOf = (d: string) => (g === "day" ? d : g === "month" ? d.slice(0, 7) : weekStart(d));
      const agg = new Map<string, { spend: number; revenue: number; nc: number; meta: number; purchases: number; imp: number; clicks: number }>();
      for (const d of series) {
        const k = bucketOf(d.date);
        const a = agg.get(k) ?? { spend: 0, revenue: 0, nc: 0, meta: 0, purchases: 0, imp: 0, clicks: 0 };
        a.spend += d.spend; a.revenue += d.revenue; a.nc += d.nc_revenue;
        a.purchases += d.purchases; a.imp += d.impressions; a.clicks += d.clicks; a.meta += d.meta_reported_revenue;
        agg.set(k, a);
      }
      const shape = (a: { spend: number; revenue: number; nc: number; meta: number; purchases: number; imp: number; clicks: number }) => ({
        meta_reported_roas: r2(ratio(a.meta, a.spend)),
        spend: r0(a.spend),
        revenue: r0(a.revenue),
        nc_revenue: r0(a.nc),
        roas: r2(ratio(a.revenue, a.spend)),
        nc_roas: r2(ratio(a.nc, a.spend)),
        cpa: r2(ratio(a.spend, a.purchases)),
        ctr_pct: r2(a.imp > 0 ? (a.clicks / a.imp) * 100 : null),
      });
      const total = [...agg.values()].reduce(
        (t, a) => ({ spend: t.spend + a.spend, revenue: t.revenue + a.revenue, nc: t.nc + a.nc, meta: t.meta + a.meta, purchases: t.purchases + a.purchases, imp: t.imp + a.imp, clicks: t.clicks + a.clicks }),
        { spend: 0, revenue: 0, nc: 0, meta: 0, purchases: 0, imp: 0, clicks: 0 }
      );
      return json({
        window: w,
        granularity: g,
        note: g === "week" ? "Weeks start on Monday; the first and last may be partial." : undefined,
        total: shape(total),
        series: [...agg.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, a]) => ({ period, ...shape(a) })),
      });
    },
  });

  const unmatchedSpend = betaZodTool({
    name: "unmatched_spend",
    description:
      "Meta spend in the window that could not be attributed to any brief on the dashboard (no DTC number, or a DTC number with no card), with the reason. " +
      "Check this when totals look low, or when asked about missing briefs.",
    inputSchema: z.object({ ...WindowShape, limit: z.number().int().min(1).max(60).optional() }),
    run: async (input) => {
      const w = resolveWindow(ctx, input.start, input.end, input.ad_account);
      onCall(`Checking unattributed spend · ${describeWindow(w)}`);
      const data = await windowData(ctx, w);
      const spend = data.unmatched.reduce((s, u) => s + u.spend, 0);
      return json({
        window: w,
        account_spend: r0(data.totalSpend),
        unmatched_spend: r0(spend),
        unmatched_pct: r2(ratio(spend * 100, data.totalSpend)),
        unmatched_ads: data.unmatched.length,
        top: data.unmatched.slice(0, input.limit ?? 20).map((u) => ({ ...u, spend: r0(u.spend) })),
      });
    },
  });

  const monthlyReport = betaZodTool({
    name: "get_monthly_report",
    description:
      "The saved monthly learnings report for a month (YYYY-MM): the team's written summary (what worked, what didn't, next month's bets) and every brief's verdict. " +
      "Two views: launched (first Meta spend that month) and created (card created that month). Performance in it is lifetime as of the report's as_of date.",
    inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
    run: async (input) => {
      onCall(`Reading the ${input.month} learnings report`);
      const { data, error } = await ctx.admin
        .from("monthly_learnings")
        .select("month, as_of, min_spend, nc_roas_target, data, summary")
        .eq("month", input.month)
        .maybeSingle();
      if (error) return json({ error: error.message });
      if (!data) {
        const { data: months } = await ctx.admin.from("monthly_learnings").select("month").order("month", { ascending: false });
        return json({ error: `No saved report for ${input.month}.`, available: (months ?? []).map((m) => m.month) });
      }
      type View = { totals: unknown; briefs: { dtc_number: number | null; name: string; verdict: string; spend: number; nc_roas: number | null; first_spend: string | null }[] };
      const view = (v: View | undefined) =>
        v && {
          totals: v.totals,
          briefs: v.briefs.map((b) => ({ dtc: b.dtc_number, name: b.name, verdict: b.verdict, spend: r0(b.spend), nc_roas: r2(b.nc_roas), launched: b.first_spend })),
        };
      const summary = data.summary as Record<string, unknown> | null;
      // Reports saved before the two-view split hold a single summary object.
      const summaries = summary && "headline" in summary ? { launched: summary, created: null } : summary;
      return json({
        month: data.month,
        as_of: data.as_of,
        rule: { minSpend: data.min_spend, ncTarget: data.nc_roas_target },
        account_month: data.data?.account,
        summary: summaries,
        launched: view(data.data?.launched),
        created: view(data.data?.created),
      });
    },
  });

  const tagValues = betaZodTool({
    name: "list_tag_values",
    description: "Distinct values of a field across all briefs, with how many briefs carry each. Use it to find the exact spelling of a persona, problem, editor, etc.",
    inputSchema: z.object({ dimension: z.enum(TEXT_FIELDS) }),
    run: async (input) => {
      onCall(`Listing ${input.dimension.replace("_", " ")} values`);
      const counts = new Map<string, number>();
      for (const ad of ctx.ads) {
        const v = fieldOf(ad, input.dimension)?.trim() || "(unassigned)";
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return json({
        dimension: input.dimension,
        values: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, briefs]) => ({ value, briefs })),
      });
    },
  });

  const viewCreatives = betaZodTool({
    name: "view_creatives",
    description:
      "Look at the actual ad creatives (thumbnail images) behind one or more briefs, highest spend first, each labelled with its spend and NC ROAS. " +
      "Use it for visual questions: what winning statics have in common, how two briefs differ, what a hook looks like. Video ads show their cover frame only.",
    inputSchema: z.object({
      dtc_numbers: z.array(z.number().int()).min(1).max(6),
      per_brief: z.number().int().min(1).max(4).optional().describe("Creatives per brief, default 2."),
      ...WindowShape,
    }),
    run: async (input) => {
      const w = resolveWindow(ctx, input.start, input.end, input.ad_account);
      onCall(`Looking at creatives for ${input.dtc_numbers.map((n) => `DTC #${n}`).join(", ")}`);
      const data = await windowData(ctx, w);
      const blocks: BetaToolResultContentBlockParam[] = [];
      let shown = 0;
      for (const dtc of input.dtc_numbers) {
        const ad = ctx.ads.find((a) => a.dtc_number === dtc);
        if (!ad) {
          blocks.push({ type: "text", text: `DTC #${dtc}: no such brief.` });
          continue;
        }
        const p = data.byAd.get(ad.id);
        const seen = new Set<string>();
        const chosen = (p?.metas ?? [])
          .filter((m) => m.image_url)
          .sort((a, b) => b.spend - a.spend)
          .filter((m) => !seen.has(m.image_url!) && !!seen.add(m.image_url!))
          .slice(0, input.per_brief ?? 2);
        const list = chosen.length
          ? chosen.map((m) => ({ url: m.image_url!, label: `“${m.ad_name}”, spend $${r0(m.spend)}, NC ROAS ${r2(ratio(m.nc_revenue, m.spend)) ?? "n/a"}` }))
          : ad.meta_ad_image_url
            ? [{ url: ad.meta_ad_image_url, label: "top creative (from the last sync)" }]
            : [];
        if (!list.length) {
          blocks.push({ type: "text", text: `DTC #${dtc} (${ad.ad_name}): no creative images available.` });
          continue;
        }
        for (const item of list) {
          if (shown >= 12) break;
          const img = await fetchImage(item.url);
          blocks.push({ type: "text", text: `DTC #${dtc} (${ad.ad_name}): ${item.label}. Thumbnail URL: ${item.url}` });
          if (img) {
            blocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
            ctx.images.add(item.url);
            shown++;
          } else {
            blocks.push({ type: "text", text: "(image couldn't be loaded)" });
          }
        }
      }
      return blocks;
    },
  });

  const FIELD_NAMES = Object.keys(EDITABLE_FIELDS) as [string, ...string[]];
  const proposeChanges = betaZodTool({
    name: "propose_changes",
    description:
      "Change fields on one or more brief cards: tags, assignments, priority, due date, links, notes, stage moves, close-out result/learning/numbers. " +
      "The user sees a before → after card and must approve it (unless they turned confirmation off). Every change is checked against the user's role and the pipeline gates, exactly like the ad card. " +
      "Cannot delete or create cards. Put all related changes in one call.",
    inputSchema: z.object({
      summary: z.string().describe("One short line describing the change, shown on the approval card."),
      changes: z
        .array(
          z.object({
            dtc_number: z.number().int(),
            field: z.enum(FIELD_NAMES),
            value: z.union([z.string(), z.number(), z.null()]).describe("New value; null clears the field. Use exact list values (check list_tag_values when unsure)."),
          })
        )
        .min(1)
        .max(100),
    }),
    run: async (input) => {
      onCall(`Preparing ${input.changes.length} change${input.changes.length === 1 ? "" : "s"}`);
      const v = await validateChanges(ctx.admin, ctx.user, input.changes);
      if (!v.items.length) {
        return JSON.stringify({ status: "rejected", errors: v.errors.length ? v.errors : ["Nothing to change: every field already has that value."] });
      }
      const id = randomUUID();
      if (ctx.autoApprove) {
        const res = await applyChanges(
          ctx.admin,
          ctx.user,
          v.items.map((it) => ({ ad_id: it.ad_id, field: it.field, value: it.to, expected: it.from }))
        );
        ctx.emit({ type: "applied", id, summary: input.summary, items: res.applied ? res.items : [], errors: [...v.errors, ...res.errors] });
        return JSON.stringify({
          status: res.applied ? "applied" : "failed",
          note: "The user has confirmation turned off, so these were written immediately. They can undo from the card.",
          applied: res.applied ? res.items.length : 0,
          skipped: v.errors,
          errors: res.errors,
        });
      }
      ctx.emit({ type: "proposal", id, summary: input.summary, items: v.items, errors: v.errors });
      return JSON.stringify({
        status: "awaiting_approval",
        note: "Shown to the user as an approval card. NOTHING has been changed yet. Tell them to review and approve it; do not say it's done.",
        proposed: v.items.map((i) => ({ dtc: i.dtc, field: i.field, from: i.from, to: i.to })),
        skipped: v.errors,
      });
    },
  });

  const getMetaAd = betaZodTool({
    name: "get_meta_ad",
    description:
      "One individual Meta ad (not a whole brief), found by its Meta ad ID (the long number, e.g. 120249122779350390) or by part of its ad / ad set name. " +
      "Returns its spend, impressions, clicks, Triple Whale pixel results AND Meta's own reported purchases and ROAS (what Ads Manager and Moby show), which brief it rolls into, and an Ads Manager link. " +
      "Use this whenever the user gives an ad ID, or compares a number with Ads Manager or Triple Whale's Moby.",
    inputSchema: z.object({
      ad_id: z.string().regex(/^\d{6,25}$/).optional().describe("Meta ad ID, digits only."),
      name: z.string().min(2).optional().describe("Part of the ad name or ad set name, case-insensitive."),
      ...WindowShape,
    }),
    run: async (input) => {
      if (!input.ad_id && !input.name) return JSON.stringify({ error: "Give an ad_id or a name." });
      const w = resolveWindow(ctx, input.start, input.end, input.ad_account);
      onCall(`Looking up Meta ad ${input.ad_id ?? `“${input.name}”`} · ${describeWindow(w)}`);
      const data = await windowData(ctx, w);
      const q = input.name?.toLowerCase();
      const hits = data.rows
        .filter((r) => (input.ad_id ? r.ad_id === input.ad_id : `${r.ad_name} ${r.adset_name ?? ""}`.toLowerCase().includes(q!)))
        .sort((a, b) => b.spend - a.spend);
      if (!hits.length) {
        return JSON.stringify({
          window: w,
          error: "No Meta ad with spend in this window matches. Try a wider window (omit start for all time). Ads that never spent don't appear in Triple Whale.",
        });
      }
      return JSON.stringify({
        window: w,
        note: "pixel_* = Triple Whale pixel (Triple Attribution, what the dashboard and the team's rule use). meta_reported_* = Meta's own attribution, what Ads Manager and Moby show. Spend and impressions are the same in both.",
        matches: hits.length,
        ads: hits.slice(0, 20).map((r) => {
          const briefId = data.briefOfMeta.get(r.ad_id);
          const brief = briefId ? ctx.ads.find((a) => a.id === briefId) : undefined;
          if (r.image_url) ctx.images.add(r.image_url);
          return {
            meta_ad_id: r.ad_id,
            ad_name: r.ad_name,
            adset_name: r.adset_name,
            campaign_name: r.campaign_name,
            account_id: r.account_id,
            brief: brief ? { dtc: brief.dtc_number, name: brief.ad_name } : null,
            first_spend_in_window: r.first_spend,
            spend: r2(r.spend),
            impressions: r.impressions,
            clicks: r.clicks,
            ctr_pct: r2(r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null),
            pixel_purchases: r.purchases,
            pixel_revenue: r2(r.revenue),
            pixel_roas: r2(ratio(r.revenue, r.spend)),
            pixel_nc_roas: r2(ratio(r.nc_revenue, r.spend)),
            meta_reported_purchases: r.meta_reported_purchases,
            meta_reported_revenue: r2(r.meta_reported_revenue),
            meta_reported_roas: r2(ratio(r.meta_reported_revenue, r.spend)),
            thumbnail: r.image_url,
            ads_manager_url: adsManagerUrl(r.account_id, r.ad_id),
          };
        }),
      });
    },
  });

  const spendByAccount = betaZodTool({
    name: "spend_by_account",
    description:
      "Meta spend and results split by ad account for a window: spend, share, pixel ROAS / NC ROAS, Meta-reported ROAS, purchases, how many ads spent, first and last day of spend. " +
      "Use it for 'which ad accounts are we using', 'how much did we spend in Ad Account 12345', or before filtering other lookups to one account.",
    inputSchema: z.object({
      start: DATE.optional().describe("Window start. Omit for all time (~2 years)."),
      end: DATE.optional().describe("Window end. Omit for yesterday."),
    }),
    run: async (input) => {
      const w = resolveWindow(ctx, input.start, input.end);
      onCall(`Splitting spend by ad account · ${describeWindow(w)}`);
      const rows = await fetchTripleWhaleByAccount(w.start, w.end);
      const total = rows.reduce((t, r) => t + r.spend, 0);
      return JSON.stringify({
        window: w,
        note: "Pixel numbers are Triple Attribution, lifetime window. meta_reported_roas is Meta's own attribution.",
        total_spend: r0(total),
        accounts: rows.map((r) => ({
          account_id: r.account_id,
          name: ACCOUNT_LABELS[r.account_id] ?? null,
          spend: r0(r.spend),
          share_pct: r2(ratio(r.spend * 100, total)),
          roas: r2(ratio(r.revenue, r.spend)),
          nc_roas: r2(ratio(r.nc_revenue, r.spend)),
          meta_reported_roas: r2(ratio(r.meta_reported_revenue, r.spend)),
          purchases: r.purchases,
          cpa: r2(ratio(r.spend, r.purchases)),
          ctr_pct: r2(r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null),
          ads_that_spent: r.ads,
          first_spend: r.first_day,
          last_spend: r.last_day,
        })),
      });
    },
  });

  return [searchBriefs, getBrief, compareGroups, accountTrend, unmatchedSpend, monthlyReport, tagValues, viewCreatives, getMetaAd, spendByAccount, proposeChanges];
}

// ---------------------------------------------------------------------------
// Progress labels and date helpers
// ---------------------------------------------------------------------------

// Same link shape as adRowUrl() in AdDetailModal: the ad's own account plus
// the business id, without which Facebook redirects to the viewer's own account.
const META_BUSINESS_ID = (process.env.NEXT_PUBLIC_META_BUSINESS_ID || "1888429485321387").trim();
function adsManagerUrl(account: string | null, adId: string): string | null {
  const acct = (account ?? "").replace(/^act_/, "").trim();
  if (!/^\d+$/.test(acct)) return null;
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${acct}&business_id=${META_BUSINESS_ID}&global_scope_id=${META_BUSINESS_ID}&selected_ad_ids=${adId}`;
}

// Fetch a thumbnail server-side and hand it to the model as base64, so one
// dead CDN link costs that image rather than failing the whole request.
async function fetchImage(
  url: string
): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0].trim();
    const mediaType = (["image/jpeg", "image/png", "image/gif", "image/webp"] as const).find((t) => t === type);
    if (!mediaType) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4_500_000) return null;
    return { data: buf.toString("base64"), mediaType };
  } catch {
    return null;
  }
}

function describeFilters(f: Partial<Filters>): string {
  const parts: string[] = [];
  if (f.dtc_numbers?.length) parts.push(`DTC ${f.dtc_numbers.map((n) => `#${n}`).join(", ")}`);
  for (const field of TEXT_FIELDS) if (f[field]) parts.push(`${field.replace("_", " ")} “${f[field]}”`);
  if (f.text) parts.push(`“${f.text}”`);
  if (f.created_from || f.created_to) parts.push(`created ${f.created_from ?? "…"} to ${f.created_to ?? "…"}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function describeWindow(w: { start: string; end: string; all_time: boolean; account_label?: string | null }): string {
  return (w.account_label ? `${w.account_label} · ` : "") + (w.all_time ? `all time to ${w.end}` : `${w.start} → ${w.end}`);
}

function isoDaysAgo(from: string, days: number): string {
  return new Date(new Date(from).getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function weekStart(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(dt.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

function systemPrompt(ctx: Ctx): string {
  return `You answer questions about a DTC ad team's creative pipeline and its Meta performance, inside their internal dashboard. The brand is The Standard Lab (NAC-based supplements for liver, bloating, belly fat, hangovers). The people asking are creative strategists, editors, media buyers and the founder.

Today is ${new Date().toISOString().slice(0, 10)}. Performance data runs to yesterday (${ctx.asOf}); today is still filling.

How the data works — you need this to read the numbers correctly:
- A "brief" is one dashboard card with a DTC number (e.g. DTC #82). Under it sit many Meta ads (creatives, variants, iterations, duplicated ad sets); their spend and revenue are summed into the brief. Decimal variants (#21.1, #21.2) roll up into the parent #21.
- Performance comes from Triple Whale's pixel (Triple Attribution), not Meta's self-reported numbers, and covers all six of the shop's Meta ad accounts. It will not match Ads Manager or Atria exactly — don't treat that as an error.
- NC ROAS = new-customer revenue ÷ spend. It is the team's headline metric. ROAS = all revenue ÷ spend. Both are margin-blind.
- Two attributions exist for the same ads. The default numbers (roas, nc_roas, purchases) are Triple Whale's pixel. meta_reported_roas / meta_reported_purchases are Meta's own attribution: what Ads Manager and Triple Whale's Moby show. Spend and impressions are identical in both; purchases and revenue differ, usually with the pixel finding more. When the user compares with Ads Manager or Moby, or asks about "Meta's numbers", lead with the Meta-reported figures and show the pixel ones beside them.
- The shop has run Meta ads in several ad accounts; Triple Whale sees all of them and every number is all accounts combined unless a tool was given ad_account. Since mid-July 2026 nearly all spend is in "Ad Account 12345" (act_2223260745102430). Use spend_by_account for the split, and pass ad_account when the user asks about one account. Say which account(s) a number covers whenever it matters.
- Scope matters as much as attribution. A brief sums every Meta ad under it; one Meta ad is a single creative. If the user gives an ad ID or a creative name, use get_meta_ad and answer for that ad, then say which brief it belongs to and how the brief did overall. Always say which scope, which dates and which attribution a number is.
- The user can attach images (screenshots, creatives, competitors' ads) and PDFs (briefs, reports) to a question. Look at them directly. An attached ad is not necessarily one of ours: only treat it as ours if it carries a DTC number or the user says so, and compare it against our data with the tools when that helps.
- Links: when you mention a specific Meta ad, you may link it as [Open in Ads Manager](ads_manager_url), using only an ads_manager_url a tool returned.
- The team's rule: a brief is a Winner when it spent at least $${ctx.rule.minSpend} and reached NC ROAS ${ctx.rule.ncTarget}; Loser if it spent that much but fell short; "Too early" below $${ctx.rule.minSpend}. Tools return this as verdict_by_rule for the window you ask about. The stored "result" field on cards is almost never filled in — rely on verdict_by_rule.
- "All time" means roughly the last two years. A window counts only spend inside it, so a brief launched in June looks small in a September window.
- Some spend can't be attributed to any brief (no DTC number in the Meta names, or a DTC number nobody created a card for). If totals look low, check unmatched_spend.
- Tags (persona, problem, angle, concept, format...) are set by hand and can be blank. "concept" is mostly empty.

How to answer:
- Every number you state must come from a tool result in this conversation. Never estimate, extrapolate or fill a gap from general knowledge. If the data can't answer the question, say what's missing.
- When the question doesn't name a period, pick a sensible one and say which you used (e.g. "last 30 days" for "lately", all time for "ever"). Don't ask a clarifying question when a reasonable default exists.
- Name briefs as "DTC #N (name)".
- Flag thin evidence: a group or ranking resting on 1–2 briefs, or on small spend, is a hint, not a finding. Prefer ranking ratios only among briefs with meaningful spend.
- Compare against the account baseline (account_trend) when judging whether something is good.
- Lead with the direct answer in a sentence or two, then the supporting numbers. Use a compact markdown table when comparing three or more rows. Keep it short — strategists read this between tasks.

Changing things:
- The person asking is ${ctx.user.name ?? ctx.user.email} (role: ${ctx.user.role ?? "none"}). They can change: ${editableFor(ctx.user.role)}. For anything else, tell them which role can.
- Use propose_changes only when they ask for a change, or clearly agree to one you suggested. Never change things on your own initiative.
- ${ctx.autoApprove ? "They turned confirmation off for this chat, so valid changes are written immediately. Say exactly what changed." : "Changes go to an approval card first. Nothing changes until they press Approve. Say so, and never claim it's done."}
- Look up exact values first (list_tag_values, or get_brief for the card's current state). "Me" / "mine" means ${ctx.user.name ?? "the person asking"}.
- You cannot delete or create cards. Moving into Testing goes through the pre-launch checklist on the card.

Pictures and charts:
- To show creatives, put markdown images on their own lines: ![DTC #12 top creative](URL). Only use URLs that came back from a tool (the "thumbnail" fields, or view_creatives). Never invent one. Show a few, not dozens.
- When a chart says more than a table (a trend, or several groups side by side), add one fenced code block with language "chart" holding JSON:
  {"type": "bar" | "line", "title": "...", "x": ["label", ...], "series": [{"name": "...", "values": [number or null, ...]}], "format": "usd" | "ratio" | "pct" | "number"}
  One format per chart, so one axis: never mix spend and ROAS in one chart, make two. At most 4 series and 24 x labels. Every value must come from a tool result.
- You can look at creatives with view_creatives and describe what you see, but you can't create or edit images.`;
}

function editableFor(role: string | null): string {
  const labels = Object.values(EDITABLE_FIELDS)
    .filter((spec) => can(role, spec.action))
    .map((spec) => spec.label.toLowerCase());
  return labels.length ? labels.join(", ") : "nothing (their role is read-only here)";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Claude Opus 5.5 list prices, $/million tokens. For the cost line under each
// answer only — not billing.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export async function askDashboard(
  admin: SupabaseClient,
  history: ChatTurn[],
  emit: (e: AskEvent) => void,
  opts: AskOptions
): Promise<void> {
  const [{ data: ads, error }, rule] = await Promise.all([admin.from("ads").select("*"), loadThresholds(admin)]);
  if (error) throw new Error(`Couldn't load ads: ${error.message}`);

  const ctx: Ctx = {
    admin,
    user: opts.user,
    autoApprove: opts.autoApprove,
    emit,
    images: new Set(),
    ads: (ads ?? []) as Ad[],
    asOf: yesterday(),
    rule,
    windows: new Map(),
  };
  let toolCalls = 0;
  const tools = buildTools(ctx, (label) => {
    toolCalls++;
    emit({ type: "tool", label });
  });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Text-only history: earlier turns carry the question and the final answer,
  // not tool calls or thinking blocks. Nothing replayed means nothing for the
  // preserved-thinking check to reject, and the answers already carry the
  // numbers a follow-up needs. Within a turn the runner keeps everything.
  const runner = client.beta.messages.toolRunner({
    model: ASK_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    cache_control: { type: "ephemeral" },
    system: systemPrompt(ctx),
    tools,
    messages: history.map((t) => ({ role: t.role, content: turnContent(t) })),
    max_iterations: MAX_ITERATIONS,
  });

  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let last: Anthropic.Beta.BetaMessage | null = null;
  for await (const message of runner) {
    last = message;
    usage.input_tokens += message.usage.input_tokens ?? 0;
    usage.output_tokens += message.usage.output_tokens ?? 0;
    usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
    usage.cache_creation_input_tokens += message.usage.cache_creation_input_tokens ?? 0;
  }
  if (!last) throw new Error("No response from Claude.");
  if (last.stop_reason === "refusal") throw new Error("Claude declined to answer that question.");

  let text = last.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
  if (last.stop_reason === "tool_use") {
    text = (text ? text + "\n\n" : "") + "_I ran out of lookups before finishing. Try a narrower question._";
  } else if (last.stop_reason === "max_tokens") {
    text += "\n\n_(Answer cut off — it ran too long.)_";
  }
  if (!text) text = "_No answer came back. Try rephrasing the question._";

  const cost =
    (usage.input_tokens * PRICE.input +
      usage.output_tokens * PRICE.output +
      usage.cache_read_input_tokens * PRICE.cacheRead +
      usage.cache_creation_input_tokens * PRICE.cacheWrite) /
    1_000_000;

  emit({
    type: "answer",
    text,
    usage: { ...usage, cost_usd: Math.round(cost * 1000) / 1000, tool_calls: toolCalls },
    images: [...ctx.images],
  });
}

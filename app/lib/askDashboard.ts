// Server-only: "Ask the dashboard" — Opus 5.5 answering questions about the
// pipeline and its performance through read-only tools.
//
// Every number the model quotes has to come out of a tool here. The tools
// read the ads table (service role) and Triple Whale; none of them write.
// Performance uses the same path as the monthly learnings report — Triple
// Whale per-ad rows → matchInsights() → summed per brief — so a figure in a
// chat answer reconciles with the report for the same window.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ad } from "@/app/types";
import { matchInsights, extractDtcVariant } from "@/app/lib/metaMatch";
import {
  fetchTripleWhaleAdsInRange,
  fetchTripleWhaleAccountDaily,
  type LifetimeAdRow,
} from "@/app/lib/tripleWhale";
import { loadThresholds, yesterday } from "@/app/lib/monthlyLearningsRun";
import { createdMonth } from "@/app/lib/adDates";

export const ASK_MODEL = "claude-opus-5-5";
const ALL_TIME_DAYS = 730; // same cap as the sync's "maximum"
const MAX_ITERATIONS = 14;

export type AskEvent =
  | { type: "tool"; label: string }
  | { type: "answer"; text: string; usage: AskUsage }
  | { type: "error"; error: string };

export interface AskUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  tool_calls: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
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
  impressions: number;
  clicks: number;
  first_spend: string | null;
  metas: LifetimeAdRow[];
}

interface WindowData {
  start: string;
  end: string;
  byAd: Map<string, BriefPerf>;
  unmatched: { ad_name: string; adset_name: string | null; spend: number; reason: string }[];
  totalSpend: number;
}

interface Ctx {
  admin: SupabaseClient;
  ads: Ad[];
  asOf: string;
  rule: { minSpend: number; ncTarget: number };
  windows: Map<string, Promise<WindowData>>;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

function resolveWindow(ctx: Ctx, start?: string, end?: string) {
  const e = end && end < ctx.asOf ? end : ctx.asOf;
  const allStart = new Date(new Date(ctx.asOf).getTime() - ALL_TIME_DAYS * 86_400_000).toISOString().slice(0, 10);
  const s = start && start > allStart ? start : allStart;
  return { start: s, end: e, all_time: !start };
}

function windowData(ctx: Ctx, start: string, end: string): Promise<WindowData> {
  const key = `${start}|${end}`;
  let p = ctx.windows.get(key);
  if (!p) {
    p = (async () => {
      const rows = await fetchTripleWhaleAdsInRange(start, end);
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
          first_spend: metas.length ? metas.map((x) => x.first_spend).sort()[0] : null,
          metas,
        });
      }
      return {
        start,
        end,
        byAd,
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
    ctr_pct: r2(p.impressions > 0 ? (p.clicks / p.impressions) * 100 : null),
    cvr_pct: r2(p.clicks > 0 ? (p.purchases / p.clicks) * 100 : null),
    first_spend_in_window: p.first_spend,
    meta_ads: p.metas.length,
    verdict_by_rule: verdict(ctx, p),
  };
}

function briefOut(ctx: Ctx, ad: Ad, p: BriefPerf | undefined) {
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
    perf: perfOut(ctx, p),
  };
}

function totalsOf(ctx: Ctx, perfs: (BriefPerf | undefined)[]) {
  const ps = perfs.filter((p): p is BriefPerf => !!p && p.spend > 0);
  const spend = ps.reduce((s, p) => s + p.spend, 0);
  const nc = ps.reduce((s, p) => s + p.nc_revenue, 0);
  const rev = ps.reduce((s, p) => s + p.revenue, 0);
  const purchases = ps.reduce((s, p) => s + p.purchases, 0);
  const verdicts = perfs.map((p) => verdict(ctx, p));
  return {
    briefs_with_spend: ps.length,
    spend: r0(spend),
    nc_roas: r2(ratio(nc, spend)),
    roas: r2(ratio(rev, spend)),
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
      const w = resolveWindow(ctx, input.start, input.end);
      onCall(`Searching briefs${describeFilters(input)} · ${describeWindow(w)}`);
      const data = await windowData(ctx, w.start, w.end);
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
      const w = resolveWindow(ctx, input.start, input.end);
      onCall(`Opening DTC #${input.dtc_number} · ${describeWindow(w)}`);
      const matches = ctx.ads.filter((a) => a.dtc_number === input.dtc_number);
      if (!matches.length) return json({ error: `No brief with DTC #${input.dtc_number} on the dashboard.` });
      const data = await windowData(ctx, w.start, w.end);
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
              .map((m) => ({
                ad_name: m.ad_name,
                adset_name: m.adset_name,
                variant: extractDtcVariant(m.ad_name) ?? extractDtcVariant(m.adset_name),
                first_spend_in_window: m.first_spend,
                spend: r0(m.spend),
                nc_roas: r2(ratio(m.nc_revenue, m.spend)),
                roas: r2(ratio(m.revenue, m.spend)),
                cpa: r2(ratio(m.spend, m.purchases)),
                ctr_pct: r2(m.impressions > 0 ? (m.clicks / m.impressions) * 100 : null),
              })),
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
      const w = resolveWindow(ctx, input.start, input.end);
      onCall(`Comparing by ${input.dimension.replace("_", " ")}${describeFilters(input)} · ${describeWindow(w)}`);
      const data = await windowData(ctx, w.start, w.end);
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
      const w = resolveWindow(ctx, input.start ?? isoDaysAgo(ctx.asOf, 89), input.end);
      const days = (new Date(w.end).getTime() - new Date(w.start).getTime()) / 86_400_000 + 1;
      const g = input.granularity ?? (days <= 31 ? "day" : days <= 183 ? "week" : "month");
      onCall(`Account trend by ${g} · ${describeWindow(w)}`);
      const series = await fetchTripleWhaleAccountDaily(w.start, w.end);
      const bucketOf = (d: string) => (g === "day" ? d : g === "month" ? d.slice(0, 7) : weekStart(d));
      const agg = new Map<string, { spend: number; revenue: number; nc: number; purchases: number; imp: number; clicks: number }>();
      for (const d of series) {
        const k = bucketOf(d.date);
        const a = agg.get(k) ?? { spend: 0, revenue: 0, nc: 0, purchases: 0, imp: 0, clicks: 0 };
        a.spend += d.spend; a.revenue += d.revenue; a.nc += d.nc_revenue;
        a.purchases += d.purchases; a.imp += d.impressions; a.clicks += d.clicks;
        agg.set(k, a);
      }
      const shape = (a: { spend: number; revenue: number; nc: number; purchases: number; imp: number; clicks: number }) => ({
        spend: r0(a.spend),
        revenue: r0(a.revenue),
        nc_revenue: r0(a.nc),
        roas: r2(ratio(a.revenue, a.spend)),
        nc_roas: r2(ratio(a.nc, a.spend)),
        cpa: r2(ratio(a.spend, a.purchases)),
        ctr_pct: r2(a.imp > 0 ? (a.clicks / a.imp) * 100 : null),
      });
      const total = [...agg.values()].reduce(
        (t, a) => ({ spend: t.spend + a.spend, revenue: t.revenue + a.revenue, nc: t.nc + a.nc, purchases: t.purchases + a.purchases, imp: t.imp + a.imp, clicks: t.clicks + a.clicks }),
        { spend: 0, revenue: 0, nc: 0, purchases: 0, imp: 0, clicks: 0 }
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
      const w = resolveWindow(ctx, input.start, input.end);
      onCall(`Checking unattributed spend · ${describeWindow(w)}`);
      const data = await windowData(ctx, w.start, w.end);
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

  return [searchBriefs, getBrief, compareGroups, accountTrend, unmatchedSpend, monthlyReport, tagValues];
}

// ---------------------------------------------------------------------------
// Progress labels and date helpers
// ---------------------------------------------------------------------------

function describeFilters(f: Partial<Filters>): string {
  const parts: string[] = [];
  if (f.dtc_numbers?.length) parts.push(`DTC ${f.dtc_numbers.map((n) => `#${n}`).join(", ")}`);
  for (const field of TEXT_FIELDS) if (f[field]) parts.push(`${field.replace("_", " ")} “${f[field]}”`);
  if (f.text) parts.push(`“${f.text}”`);
  if (f.created_from || f.created_to) parts.push(`created ${f.created_from ?? "…"} to ${f.created_to ?? "…"}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function describeWindow(w: { start: string; end: string; all_time: boolean }): string {
  return w.all_time ? `all time to ${w.end}` : `${w.start} → ${w.end}`;
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
- You can only read. If asked to change, move, tag or create something, say it has to be done in the dashboard itself.`;
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
  emit: (e: AskEvent) => void
): Promise<void> {
  const [{ data: ads, error }, rule] = await Promise.all([admin.from("ads").select("*"), loadThresholds(admin)]);
  if (error) throw new Error(`Couldn't load ads: ${error.message}`);

  const ctx: Ctx = { admin, ads: (ads ?? []) as Ad[], asOf: yesterday(), rule, windows: new Map() };
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
    messages: history.map((t) => ({ role: t.role, content: t.content })),
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

  emit({ type: "answer", text, usage: { ...usage, cost_usd: Math.round(cost * 1000) / 1000, tool_calls: toolCalls } });
}

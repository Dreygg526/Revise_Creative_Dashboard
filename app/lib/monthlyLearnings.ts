// ============================================================
// MONTHLY LEARNINGS — which briefs launched in a month, and how they did.
//
// Pure: no I/O, so it can be compiled standalone and driven from Node the
// same way metaMatch.ts and gates.ts are.
//
// Definitions, settled 2026-10-04 (Axel's rule: "amount spent x NC ROAS"):
// - A brief LAUNCHED in the month its first Meta ad first spent. The
//   dashboard records no launch date; this is the only one there is.
// - Performance is lifetime to `asOf`, summed over every Meta ad the matcher
//   attributes to the brief — same roll-up as the sync.
// - Winner  = spend >= minSpend AND NC ROAS >= ncTarget
//   Loser   = spend >= minSpend AND NC ROAS <  ncTarget
//   Too early = spend < minSpend (not enough money behind it to judge)
// - NC ROAS = new-customer revenue / spend (Triple Attribution, lifetime).
//
// This produces a report. It deliberately does NOT write ads.result — the
// verdict is a snapshot, ads keep spending after it, and OpenClaw already
// owns that column through the agent API.
// ============================================================

import { matchInsights, type MetaInsightRow } from "./metaMatch";
import type { Ad } from "@/app/types";

export interface LifetimeRow extends MetaInsightRow {
  first_spend: string;
  nc_revenue: number;
  nc_orders: number;
}

export type Verdict = "Winner" | "Loser" | "Too early";

export interface LearningCreative {
  ad_id: string;
  ad_name: string;
  account_id: string | null;
  first_spend: string;
  spend: number;
  nc_roas: number | null;
}

export interface LearningBrief {
  ad_id: string;               // dashboard ads.id
  dtc_number: number | null;
  name: string;
  stage: string;
  product: string | null;
  persona: string | null;
  core_emotion: string | null;
  problem: string | null;
  awareness: string | null;
  angle: string | null;
  concept: string | null;
  ad_type: string | null;
  format: string | null;
  strategist: string | null;
  editor: string | null;
  first_spend: string;
  spend: number;
  revenue: number;
  nc_revenue: number;
  purchases: number;
  nc_orders: number;
  nc_roas: number | null;
  roas: number | null;
  cpa: number | null;
  meta_ads: number;
  verdict: Verdict;
  top_creatives: LearningCreative[];  // up to 3, by spend
}

export interface TagRow {
  dimension: string;
  value: string;
  briefs: number;
  judged: number;        // briefs past minSpend
  winners: number;
  spend: number;
  nc_roas: number | null;   // blended: sum NC revenue / sum spend
}

export interface MonthlyReportData {
  month: string;           // YYYY-MM
  as_of: string;           // YYYY-MM-DD
  min_spend: number;
  nc_roas_target: number;
  totals: {
    briefs: number;
    winners: number;
    losers: number;
    too_early: number;
    spend: number;
    nc_revenue: number;
    nc_roas: number | null;
  };
  // Whole Meta account over the calendar month — the baseline.
  account: { spend: number; nc_revenue: number; nc_roas: number | null } | null;
  briefs: LearningBrief[];   // winners first, then losers, then too early; spend-sorted within
  tags: TagRow[];
  // Meta ads that first spent this month but match no dashboard brief.
  unmatched: { ads: number; spend: number; top: { ad_name: string; adset_name: string | null; spend: number }[] };
}

export const TAG_DIMENSIONS: { key: keyof LearningBrief; label: string }[] = [
  { key: "persona", label: "Persona" },
  { key: "problem", label: "Problem" },
  { key: "core_emotion", label: "Core emotion" },
  { key: "awareness", label: "Awareness" },
  { key: "ad_type", label: "Ad type" },
  { key: "format", label: "Format" },
  { key: "product", label: "Product" },
  { key: "strategist", label: "Strategist" },
  { key: "editor", label: "Editor" },
];

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

// The month before the one `today` falls in, as YYYY-MM.
export function previousMonth(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

export function buildMonthlyReport(args: {
  month: string;
  asOf: string;
  minSpend: number;
  ncTarget: number;
  rows: LifetimeRow[];
  ads: Ad[];
  account: { spend: number; ncRevenue: number } | null;
}): MonthlyReportData {
  const { month, asOf, minSpend, ncTarget, rows, ads } = args;
  const { start, end } = monthBounds(month);
  const inMonth = (d: string) => d >= start && d <= end;

  const byMetaId = new Map(rows.map((r) => [r.ad_id, r]));
  const adById = new Map(ads.map((a) => [a.id, a]));
  const { matches, unmatched } = matchInsights(rows, ads);

  const briefs: LearningBrief[] = [];
  for (const m of matches) {
    const ad = adById.get(m.adId);
    if (!ad) continue;
    const metas = m.metaAdIds.map((id) => byMetaId.get(id)).filter((x): x is LifetimeRow => !!x);
    if (metas.length === 0) continue;
    const firstSpend = metas.reduce((min, x) => (x.first_spend < min ? x.first_spend : min), metas[0].first_spend);
    if (!inMonth(firstSpend)) continue;

    const ncRevenue = metas.reduce((s, x) => s + x.nc_revenue, 0);
    const ncOrders = metas.reduce((s, x) => s + x.nc_orders, 0);
    const ncRoas = ratio(ncRevenue, m.spend);
    const verdict: Verdict =
      m.spend < minSpend ? "Too early" : (ncRoas ?? 0) >= ncTarget ? "Winner" : "Loser";

    briefs.push({
      ad_id: ad.id,
      dtc_number: ad.dtc_number,
      name: ad.ad_name || "",
      stage: ad.stage,
      product: ad.product,
      persona: ad.persona,
      core_emotion: ad.core_emotion,
      problem: ad.problem,
      awareness: ad.awareness,
      angle: ad.angle,
      concept: ad.concept,
      ad_type: ad.ad_type,
      format: ad.format,
      strategist: ad.assigned_strategist,
      editor: ad.assigned_editor,
      first_spend: firstSpend,
      spend: m.spend,
      revenue: m.revenue,
      nc_revenue: ncRevenue,
      purchases: m.purchases,
      nc_orders: ncOrders,
      nc_roas: ncRoas,
      roas: ratio(m.revenue, m.spend),
      cpa: m.purchases > 0 ? m.spend / m.purchases : null,
      meta_ads: metas.length,
      verdict,
      top_creatives: [...metas]
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 3)
        .map((x) => ({
          ad_id: x.ad_id,
          ad_name: x.ad_name,
          account_id: x.account_id,
          first_spend: x.first_spend,
          spend: x.spend,
          nc_roas: ratio(x.nc_revenue, x.spend),
        })),
    });
  }

  const order: Record<Verdict, number> = { Winner: 0, Loser: 1, "Too early": 2 };
  briefs.sort((a, b) => order[a.verdict] - order[b.verdict] || b.spend - a.spend);

  // Tag breakdown. Blended NC ROAS per bucket (sum over sum), never a mean
  // of per-brief ratios — same rule as CVR and CPA elsewhere in the app.
  const tags: TagRow[] = [];
  for (const dim of TAG_DIMENSIONS) {
    const buckets = new Map<string, LearningBrief[]>();
    for (const b of briefs) {
      const raw = b[dim.key];
      const value = raw != null && String(raw).trim() ? String(raw).trim() : "— Unassigned";
      if (!buckets.has(value)) buckets.set(value, []);
      buckets.get(value)!.push(b);
    }
    for (const [value, list] of buckets) {
      const spend = list.reduce((s, b) => s + b.spend, 0);
      const nc = list.reduce((s, b) => s + b.nc_revenue, 0);
      tags.push({
        dimension: dim.label,
        value,
        briefs: list.length,
        judged: list.filter((b) => b.verdict !== "Too early").length,
        winners: list.filter((b) => b.verdict === "Winner").length,
        spend,
        nc_roas: ratio(nc, spend),
      });
    }
  }
  tags.sort((a, b) => a.dimension.localeCompare(b.dimension) || b.spend - a.spend);

  const unm = unmatched
    .map((u) => ({ u, row: byMetaId.get(u.ad_id) }))
    .filter((x) => x.row && inMonth(x.row.first_spend))
    .sort((a, b) => b.u.spend - a.u.spend);

  const spend = briefs.reduce((s, b) => s + b.spend, 0);
  const nc = briefs.reduce((s, b) => s + b.nc_revenue, 0);

  return {
    month,
    as_of: asOf,
    min_spend: minSpend,
    nc_roas_target: ncTarget,
    totals: {
      briefs: briefs.length,
      winners: briefs.filter((b) => b.verdict === "Winner").length,
      losers: briefs.filter((b) => b.verdict === "Loser").length,
      too_early: briefs.filter((b) => b.verdict === "Too early").length,
      spend,
      nc_revenue: nc,
      nc_roas: ratio(nc, spend),
    },
    account: args.account
      ? {
          spend: args.account.spend,
          nc_revenue: args.account.ncRevenue,
          nc_roas: ratio(args.account.ncRevenue, args.account.spend),
        }
      : null,
    briefs,
    tags,
    unmatched: {
      ads: unm.length,
      spend: unm.reduce((s, x) => s + x.u.spend, 0),
      top: unm.slice(0, 10).map((x) => ({
        ad_name: x.u.ad_name,
        adset_name: x.row!.adset_name,
        spend: x.u.spend,
      })),
    },
  };
}

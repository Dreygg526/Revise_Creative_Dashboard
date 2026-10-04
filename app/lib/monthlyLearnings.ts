// ============================================================
// MONTHLY LEARNINGS — which briefs belong to a month, and how they did.
//
// Pure: no I/O, so it can be compiled standalone and driven from Node the
// same way metaMatch.ts and gates.ts are.
//
// Definitions, settled 2026-10-04 (Axel's rule: "amount spent x NC ROAS"):
// - Two views of "the month", both built on every run (the user asked for both):
//   LAUNCHED — briefs whose first Meta ad first spent in the month. The
//     dashboard records no launch date; this is the only one there is.
//   CREATED  — briefs whose dashboard card was created in the month (UTC, the
//     same rule as the board's Created filter, see adDates.ts). Some of these
//     haven't launched yet; they are "No spend found" and never judged.
// - Performance is lifetime to `asOf`, summed over every Meta ad the matcher
//   attributes to the brief — same roll-up as the sync.
// - Winner  = spend >= minSpend AND NC ROAS >= ncTarget
//   Loser   = spend >= minSpend AND NC ROAS <  ncTarget
//   Too early = spent, but less than minSpend (not enough money to judge)
//   No spend found = no matched Meta spend: not launched yet, OR live but its
//     Meta ads carry no DTC number the matcher can place (7 such in Sept)
// - NC ROAS = new-customer revenue / spend (Triple Attribution, lifetime).
//
// This produces a report. It deliberately does NOT write ads.result — the
// verdict is a snapshot, ads keep spending after it, and OpenClaw already
// owns that column through the agent API.
// ============================================================

import { matchInsights, type MetaInsightRow } from "./metaMatch";
import { createdMonth } from "./adDates";
import type { Ad } from "@/app/types";

export interface LifetimeRow extends MetaInsightRow {
  first_spend: string;
  nc_revenue: number;
  nc_orders: number;
}

export type Verdict = "Winner" | "Loser" | "Too early" | "No spend found";
export type ReportMode = "launched" | "created";

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
  created_at: string;
  first_spend: string | null;  // null = never spent
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
  judged: number;        // Winner + Loser
  winners: number;
  spend: number;
  nc_roas: number | null;   // blended: sum NC revenue / sum spend
}

export interface ReportView {
  totals: {
    briefs: number;
    winners: number;
    losers: number;
    too_early: number;
    not_launched: number;
    spend: number;
    nc_revenue: number;
    nc_roas: number | null;
  };
  briefs: LearningBrief[];   // Winner, Loser, Too early, No spend found; spend-sorted within
  tags: TagRow[];
}

export interface MonthlyReportData {
  month: string;           // YYYY-MM
  as_of: string;           // YYYY-MM-DD
  min_spend: number;
  nc_roas_target: number;
  launched: ReportView;
  created: ReportView;
  // Whole Meta account over the calendar month — the baseline.
  account: { spend: number; nc_revenue: number; nc_roas: number | null } | null;
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
  const { matches, unmatched } = matchInsights(rows, ads);
  const matchByAd = new Map(matches.map((m) => [m.adId, m]));

  // One record per dashboard ad; the two views are filters over these.
  const all: LearningBrief[] = ads.map((ad) => {
    const m = matchByAd.get(ad.id);
    const metas = (m?.metaAdIds ?? []).map((id) => byMetaId.get(id)).filter((x): x is LifetimeRow => !!x);
    const spend = m?.spend ?? 0;
    const firstSpend = metas.length
      ? metas.reduce((min, x) => (x.first_spend < min ? x.first_spend : min), metas[0].first_spend)
      : null;
    const ncRevenue = metas.reduce((s, x) => s + x.nc_revenue, 0);
    const ncRoas = ratio(ncRevenue, spend);
    const verdict: Verdict =
      !firstSpend ? "No spend found"
      : spend < minSpend ? "Too early"
      : (ncRoas ?? 0) >= ncTarget ? "Winner" : "Loser";

    return {
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
      created_at: ad.created_at,
      first_spend: firstSpend,
      spend,
      revenue: m?.revenue ?? 0,
      nc_revenue: ncRevenue,
      purchases: m?.purchases ?? 0,
      nc_orders: metas.reduce((s, x) => s + x.nc_orders, 0),
      nc_roas: ncRoas,
      roas: ratio(m?.revenue ?? 0, spend),
      cpa: m && m.purchases > 0 ? m.spend / m.purchases : null,
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
    };
  });

  const unm = unmatched
    .map((u) => ({ u, row: byMetaId.get(u.ad_id) }))
    .filter((x) => x.row && inMonth(x.row.first_spend))
    .sort((a, b) => b.u.spend - a.u.spend);

  return {
    month,
    as_of: asOf,
    min_spend: minSpend,
    nc_roas_target: ncTarget,
    launched: buildView(all.filter((b) => b.first_spend != null && inMonth(b.first_spend))),
    created: buildView(all.filter((b) => createdMonth(b.created_at) === month)),
    account: args.account
      ? {
          spend: args.account.spend,
          nc_revenue: args.account.ncRevenue,
          nc_roas: ratio(args.account.ncRevenue, args.account.spend),
        }
      : null,
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

const VERDICT_ORDER: Record<Verdict, number> = { Winner: 0, Loser: 1, "Too early": 2, "No spend found": 3 };

function buildView(list: LearningBrief[]): ReportView {
  const briefs = [...list].sort(
    (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || b.spend - a.spend
  );

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
    for (const [value, bucket] of buckets) {
      const spend = bucket.reduce((s, b) => s + b.spend, 0);
      const nc = bucket.reduce((s, b) => s + b.nc_revenue, 0);
      tags.push({
        dimension: dim.label,
        value,
        briefs: bucket.length,
        judged: bucket.filter((b) => b.verdict === "Winner" || b.verdict === "Loser").length,
        winners: bucket.filter((b) => b.verdict === "Winner").length,
        spend,
        nc_roas: ratio(nc, spend),
      });
    }
  }
  tags.sort((a, b) => a.dimension.localeCompare(b.dimension) || b.spend - a.spend);

  const spend = briefs.reduce((s, b) => s + b.spend, 0);
  const nc = briefs.reduce((s, b) => s + b.nc_revenue, 0);
  const count = (v: Verdict) => briefs.filter((b) => b.verdict === v).length;
  return {
    totals: {
      briefs: briefs.length,
      winners: count("Winner"),
      losers: count("Loser"),
      too_early: count("Too early"),
      not_launched: count("No spend found"),
      spend,
      nc_revenue: nc,
      nc_roas: ratio(nc, spend),
    },
    briefs,
    tags,
  };
}

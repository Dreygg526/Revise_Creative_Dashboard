// Server-only: per-strategist performance over the last N days (Axel's ask,
// 2026-10-09: "performance of each strategist per 7 and 30 days — spend, NC
// ROAS, CTR, amount of concepts, top spenders").
//
// Same path as Ask AI and the monthly report: Triple Whale per-ad rows →
// matchInsights() → summed per brief → summed per assigned_strategist. So a
// strategist's number reconciles with what the chat says for the same window.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ad } from "@/app/types";
import { matchInsights } from "@/app/lib/metaMatch";
import { isSelfProduced } from "@/app/lib/gates";
import {
  fetchTripleWhaleAdsInRange,
  fetchTripleWhaleLifetimeAds,
  fetchTripleWhaleVideoStats,
  type LifetimeAdRow,
  type VideoStats,
} from "@/app/lib/tripleWhale";
import { loadThresholds, yesterday } from "@/app/lib/monthlyLearningsRun";

export const STRATEGIST_WINDOWS = [7, 30, 90] as const;
export const UNASSIGNED = "Unassigned";

// Additive counts; every ratio on the page is derived from these, sum over
// sum, never an average of per-brief ratios.
export interface Sums {
  spend: number;
  revenue: number;
  nc_revenue: number;
  purchases: number;
  meta_revenue: number;
  impressions: number;
  clicks: number;
  outbound_clicks: number;
  video_impressions: number;
  v3s: number;
  thruplays: number;
}

export interface BriefRow {
  id: string;
  dtc: number | null;
  name: string;
  stage: string;
  editor: string | null;
  self_produced: boolean;
  launched: string | null;     // first day any of its Meta ads ever spent
  thumbnail: string | null;
  sums: Sums;
  // Lifetime to yesterday — what the verdict is judged on, as in the monthly report.
  lifetime_spend: number;
  lifetime_nc_roas: number | null;
  verdict: "Winner" | "Loser" | "Too early" | null;   // only for briefs launched in the window
}

export interface StrategistRow {
  name: string;
  role: string | null;          // from team_members; null = not on the team list
  sums: Sums;
  prev: Sums;
  briefs_live: number;          // spent in the window
  briefs_launched: number;      // first-ever spend inside the window
  briefs_created: number;       // card created inside the window
  winners: number;
  losers: number;
  too_early: number;
  briefs: BriefRow[];           // every brief that spent in the window, spend-sorted
}

export interface StrategistReport {
  days: number;
  start: string;
  end: string;
  prev_start: string;
  prev_end: string;
  rule: { minSpend: number; ncTarget: number };
  total: Sums;                  // every Meta ad in the window, matched or not
  prev_total: Sums;
  matched: Sums;                // the part attributed to a brief
  unmatched_spend: number;
  strategists: StrategistRow[];
  top_briefs: (BriefRow & { strategist: string })[];
  generated_at: string;
}

const NO_VIDEO: VideoStats = { video_3s_views: 0, thruplays: 0, p25: 0, p50: 0, p75: 0, p100: 0, outbound_clicks: 0, video_seconds: null };

function emptySums(): Sums {
  return { spend: 0, revenue: 0, nc_revenue: 0, purchases: 0, meta_revenue: 0, impressions: 0, clicks: 0, outbound_clicks: 0, video_impressions: 0, v3s: 0, thruplays: 0 };
}

function addRow(s: Sums, r: LifetimeAdRow, v: VideoStats) {
  s.spend += r.spend;
  s.revenue += r.revenue;
  s.nc_revenue += r.nc_revenue;
  s.purchases += r.purchases;
  s.meta_revenue += r.meta_reported_revenue;
  s.impressions += r.impressions;
  s.clicks += r.clicks;
  s.outbound_clicks += v.outbound_clicks;
  if (v.video_3s_views > 0) {
    s.video_impressions += r.impressions;
    s.v3s += v.video_3s_views;
    s.thruplays += v.thruplays;
  }
}

function addSums(a: Sums, b: Sums) {
  for (const k of Object.keys(a) as (keyof Sums)[]) a[k] += b[k];
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;

// Briefs keyed by dashboard ad id, each with the Meta rows that roll into it.
function rollUp(rows: LifetimeAdRow[], ads: Ad[]) {
  const byMeta = new Map(rows.map((r) => [r.ad_id, r]));
  const { matches } = matchInsights(rows, ads);
  const out = new Map<string, LifetimeAdRow[]>();
  for (const m of matches) {
    out.set(m.adId, m.metaAdIds.map((id) => byMeta.get(id)).filter((x): x is LifetimeAdRow => !!x));
  }
  return out;
}

export async function buildStrategistReport(admin: SupabaseClient, days: number): Promise<StrategistReport> {
  const end = yesterday();
  const endT = new Date(end).getTime();
  const start = iso(endT - (days - 1) * DAY);
  const prevEnd = iso(endT - days * DAY);
  const prevStart = iso(endT - (2 * days - 1) * DAY);

  const [adsRes, teamRes, rule, current, previous, lifetime, video] = await Promise.all([
    admin.from("ads").select("*"),
    admin.from("team_members").select("name, role"),
    loadThresholds(admin),
    fetchTripleWhaleAdsInRange(start, end),
    fetchTripleWhaleAdsInRange(prevStart, prevEnd),
    // Lifetime rows give each brief its real launch date and the totals the
    // verdict is judged on. The window rows alone would only know "first
    // spend inside the window".
    fetchTripleWhaleLifetimeAds(end),
    // Video and outbound clicks live in a different table; losing it costs
    // hook/hold rate, not the page.
    fetchTripleWhaleVideoStats(start, end).catch(() => new Map<string, VideoStats>()),
  ]);
  if (adsRes.error) throw new Error(adsRes.error.message);
  const ads = (adsRes.data ?? []) as Ad[];
  const roleOf = new Map((teamRes.data ?? []).map((t) => [String(t.name), String(t.role)]));

  const curBriefs = rollUp(current, ads);
  const prevBriefs = rollUp(previous, ads);
  const lifeBriefs = rollUp(lifetime, ads);

  const total = emptySums();
  for (const r of current) addRow(total, r, video.get(r.ad_id) ?? NO_VIDEO);
  const prevTotal = emptySums();
  for (const r of previous) addRow(prevTotal, r, NO_VIDEO);

  const groups = new Map<string, StrategistRow>();
  const group = (name: string) => {
    let g = groups.get(name);
    if (!g) {
      g = {
        name,
        role: name === UNASSIGNED ? null : roleOf.get(name) ?? null,
        sums: emptySums(), prev: emptySums(),
        briefs_live: 0, briefs_launched: 0, briefs_created: 0,
        winners: 0, losers: 0, too_early: 0, briefs: [],
      };
      groups.set(name, g);
    }
    return g;
  };

  // Every strategist on the team gets a row, so a quiet week reads as zero
  // rather than as someone missing from the page.
  for (const t of teamRes.data ?? []) if (t.role === "Strategist" && t.name) group(String(t.name));

  const matched = emptySums();
  for (const ad of ads) {
    const name = ad.assigned_strategist?.trim() || UNASSIGNED;
    const curRows = curBriefs.get(ad.id) ?? [];
    const prevRows = prevBriefs.get(ad.id) ?? [];
    const lifeRows = lifeBriefs.get(ad.id) ?? [];
    const created = ad.created_at.slice(0, 10);
    const createdIn = created >= start;   // through today: a card made this morning counts
    const launched = lifeRows.length ? lifeRows.map((r) => r.first_spend).sort()[0] : null;
    const launchedIn = !!launched && launched >= start && launched <= end;
    if (!curRows.length && !prevRows.length && !createdIn) continue;

    const g = group(name);
    if (createdIn) g.briefs_created += 1;
    for (const r of prevRows) addRow(g.prev, r, NO_VIDEO);
    if (!curRows.length) continue;

    const sums = emptySums();
    for (const r of curRows) addRow(sums, r, video.get(r.ad_id) ?? NO_VIDEO);
    if (sums.spend <= 0) continue;
    addSums(g.sums, sums);
    addSums(matched, sums);
    g.briefs_live += 1;

    const lifeSpend = lifeRows.reduce((s, r) => s + r.spend, 0);
    const lifeNc = lifeRows.reduce((s, r) => s + r.nc_revenue, 0);
    const lifeNcRoas = lifeSpend > 0 ? lifeNc / lifeSpend : null;
    let verdict: BriefRow["verdict"] = null;
    if (launchedIn) {
      g.briefs_launched += 1;
      verdict = lifeSpend < rule.minSpend ? "Too early" : (lifeNcRoas ?? 0) >= rule.ncTarget ? "Winner" : "Loser";
      if (verdict === "Winner") g.winners += 1;
      else if (verdict === "Loser") g.losers += 1;
      else g.too_early += 1;
    }
    const thumb = curRows.slice().sort((a, b) => b.spend - a.spend).find((r) => r.image_url)?.image_url ?? ad.meta_ad_image_url;
    g.briefs.push({
      id: ad.id,
      dtc: ad.dtc_number,
      name: ad.ad_name || "(untitled)",
      stage: ad.stage,
      editor: ad.assigned_editor,
      self_produced: isSelfProduced(ad),
      launched,
      thumbnail: thumb ?? null,
      sums,
      lifetime_spend: lifeSpend,
      lifetime_nc_roas: lifeNcRoas,
      verdict,
    });
  }

  const strategists = [...groups.values()];
  for (const g of strategists) g.briefs.sort((a, b) => b.sums.spend - a.sums.spend);
  strategists.sort((a, b) => b.sums.spend - a.sums.spend || b.briefs_created - a.briefs_created);

  const top_briefs = strategists
    .flatMap((g) => g.briefs.map((b) => ({ ...b, strategist: g.name })))
    .sort((a, b) => b.sums.spend - a.sums.spend)
    .slice(0, 10);

  return {
    days, start, end, prev_start: prevStart, prev_end: prevEnd, rule,
    total, prev_total: prevTotal, matched,
    unmatched_spend: Math.max(0, total.spend - matched.spend),
    strategists, top_briefs,
    generated_at: new Date().toISOString(),
  };
}

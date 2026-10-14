// Server-only: the daily Discord report (approved 2026-10-13, proposal v2).
//
// Sent at 8:00 AM PH, which is ~10:30 AM in Adelaide, the store's timezone and
// the clock Triple Whale's event_date runs on. Two days are reported because
// the boss says data takes 1–2 days to load:
//   FINAL       = 2 store days ago: the headline numbers, vs the same weekday
//                 a week earlier.
//   EARLY READ  = yesterday: spend is near-final by morning, revenue isn't, so
//                 the ratios are labelled early.
// Then yesterday's top briefs, the creatives Meta is scaling, and potential
// ads (launched in the last N days, over the potential line at or above KPI).
//
// Plain arithmetic, no AI: nothing here can be made up. Every number is
// Triple Whale pixel, Triple Attribution lifetime, all Meta ad accounts, the
// same as the rest of the dashboard.
//
// Account totals come from the account-daily query, NOT from summing per-ad
// rows: the per-ad query drops ads with no spend that day, and the revenue
// landing on them with it (Sun 4 Oct read NC 0.70 per-ad vs 0.74 true).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ad } from "@/app/types";
import { matchInsights } from "@/app/lib/metaMatch";
import {
  fetchTripleWhaleAccountDaily,
  fetchTripleWhaleAdsInRange,
  fetchTripleWhaleLifetimeAds,
  type AccountDay,
  type LifetimeAdRow,
} from "@/app/lib/tripleWhale";
import { loadLegacyThresholds } from "@/app/lib/monthlyLearningsRun";
import { facebookAdLinks } from "@/app/lib/metaLinks";
import { addDays, daysBetween, loadKpis, monthName, resolveKpi, storeDate, type ResolvedKpi } from "@/app/lib/kpi";
import { COLOR, delta, dm, dmy, plain, ratio, usd, weekday, type DiscordMessage, type Embed, type EmbedField } from "@/app/lib/discord";

// Growing vs yesterday: the boss's "creatives growing vs yesterday". Floors
// keep $20 → $60 noise out of a top-5 list.
export const GROWTH_RULE = { minBefore: 200, minAfter: 300, minGrowth: 0.3, top: 5 };
const TOP_BRIEFS = 5;
const MAX_POTENTIAL = 6;

export interface DayFigures {
  date: string;
  spend: number;
  revenue: number;
  nc_revenue: number;
  purchases: number;
  meta_revenue: number;
}

export interface CreativeLine {
  ad_id: string;
  ad_name: string;
  dtc: number | null;
  brief: string | null;
  url: string | null;       // public Facebook link (metaLinks.ts), not Ads Manager: the team can't open that
  spend: number;
  nc_roas: number | null;
}

export interface DailyReportData {
  report_date: string;      // store day the report is sent on
  final_day: string;
  early_day: string;
  final_kpi: ResolvedKpi;
  early_kpi: ResolvedKpi;
  final: { day: DayFigures; week_ago: DayFigures };
  early: { day: DayFigures; week_ago: DayFigures };
  top_briefs: { dtc: number | null; name: string; spend: number; nc_roas: number | null }[];
  unmatched_spend: number;  // yesterday's spend no brief could claim
  growing: (CreativeLine & { before: number; growth: number })[];
  potential: (CreativeLine & { launched: string; days: number })[];
  watching: (CreativeLine & { launched: string; days: number })[];
}

const r2 = (a: number, b: number) => (b > 0 ? a / b : null);

function figures(rows: AccountDay[], date: string): DayFigures {
  const d = rows.find((r) => r.date === date);
  return {
    date,
    spend: d?.spend ?? 0,
    revenue: d?.revenue ?? 0,
    nc_revenue: d?.nc_revenue ?? 0,
    purchases: d?.purchases ?? 0,
    meta_revenue: d?.meta_reported_revenue ?? 0,
  };
}

export async function buildDailyReport(admin: SupabaseClient, reportDate: string = storeDate()): Promise<DailyReportData> {
  const early = addDays(reportDate, -1);
  const final = addDays(reportDate, -2);

  const [adsRes, legacy, kpis, account, earlyRows, finalRows, lifetime] = await Promise.all([
    admin.from("ads").select("*"),
    loadLegacyThresholds(admin),
    loadKpis(admin),
    fetchTripleWhaleAccountDaily(addDays(final, -7), early),
    fetchTripleWhaleAdsInRange(early, early),
    fetchTripleWhaleAdsInRange(final, final),
    // Lifetime rows carry each Meta ad's real first spend day (its launch) and
    // its totals so far, which is what "potential" is judged on.
    fetchTripleWhaleLifetimeAds(early),
  ]);
  if (adsRes.error) throw new Error(`Couldn't load ads: ${adsRes.error.message}`);
  const ads = (adsRes.data ?? []) as Ad[];
  const earlyKpi = resolveKpi(kpis, early.slice(0, 7), legacy);
  const finalKpi = resolveKpi(kpis, final.slice(0, 7), legacy);

  // Meta ad → brief, decided once on lifetime rows so a creative maps to the
  // same brief in every section of the report.
  const briefOf = new Map<string, Ad>();
  const adById = new Map(ads.map((a) => [a.id, a]));
  for (const m of matchInsights(lifetime, ads).matches) {
    const ad = adById.get(m.adId);
    if (ad) for (const id of m.metaAdIds) briefOf.set(id, ad);
  }
  const line = (r: LifetimeAdRow, spend: number, nc: number): CreativeLine => {
    const b = briefOf.get(r.ad_id);
    return {
      ad_id: r.ad_id,
      ad_name: r.ad_name || "(no name)",
      dtc: b?.dtc_number ?? null,
      brief: b?.ad_name ?? null,
      url: null,   // filled below for the creatives the report actually lists
      spend,
      nc_roas: r2(nc, spend),
    };
  };

  // Yesterday's top briefs.
  const perBrief = new Map<string, { ad: Ad; spend: number; nc: number }>();
  let unmatched = 0;
  for (const r of earlyRows) {
    const b = briefOf.get(r.ad_id);
    if (!b) { unmatched += r.spend; continue; }
    const cur = perBrief.get(b.id) ?? { ad: b, spend: 0, nc: 0 };
    cur.spend += r.spend;
    cur.nc += r.nc_revenue;
    perBrief.set(b.id, cur);
  }
  const top_briefs = [...perBrief.values()]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP_BRIEFS)
    .map((x) => ({ dtc: x.ad.dtc_number, name: x.ad.ad_name || "(untitled)", spend: x.spend, nc_roas: r2(x.nc, x.spend) }));

  // Growing vs yesterday: early day against the day before it.
  const before = new Map(finalRows.map((r) => [r.ad_id, r.spend]));
  const growing = earlyRows
    .map((r) => ({ r, b: before.get(r.ad_id) ?? 0 }))
    .filter(({ r, b }) => b >= GROWTH_RULE.minBefore && r.spend >= GROWTH_RULE.minAfter && (r.spend - b) / b >= GROWTH_RULE.minGrowth)
    .sort((x, y) => (y.r.spend - y.b) / y.b - (x.r.spend - x.b) / x.b)
    .slice(0, GROWTH_RULE.top)
    .map(({ r, b }) => ({ ...line(r, r.spend, r.nc_revenue), before: b, growth: (r.spend - b) / b }));

  // Potential ads: launched within the KPI's window (counting yesterday as day
  // 1), at or above KPI on lifetime numbers, over the potential line.
  const windowStart = addDays(early, -(earlyKpi.potential_days - 1));
  const fresh = lifetime
    .filter((r) => r.first_spend >= windowStart && r.first_spend <= early)
    .map((r) => ({ ...line(r, r.spend, r.nc_revenue), launched: r.first_spend, days: daysBetween(r.first_spend, early) + 1 }))
    .filter((x) => (x.nc_roas ?? 0) >= earlyKpi.nc_roas_target)
    .sort((a, b) => b.spend - a.spend);
  const potential = fresh.filter((x) => x.spend >= earlyKpi.potential_spend).slice(0, MAX_POTENTIAL);
  const watching = fresh.filter((x) => x.spend >= earlyKpi.watch_spend && x.spend < earlyKpi.potential_spend).slice(0, MAX_POTENTIAL);

  const links = await facebookAdLinks([...growing, ...potential, ...watching].map((x) => x.ad_id));
  for (const x of [...growing, ...potential, ...watching]) x.url = links.get(x.ad_id) ?? null;

  return {
    report_date: reportDate,
    final_day: final,
    early_day: early,
    final_kpi: finalKpi,
    early_kpi: earlyKpi,
    final: { day: figures(account, final), week_ago: figures(account, addDays(final, -7)) },
    early: { day: figures(account, early), week_ago: figures(account, addDays(early, -7)) },
    top_briefs,
    unmatched_spend: unmatched,
    growing,
    potential,
    watching,
  };
}

// Every run records the two days it read, so the first test week can show how
// far a day moves between its early read and its final read. Missing table =
// no log, never a failed report.
export async function logDailyFigures(admin: SupabaseClient, d: DailyReportData): Promise<string | null> {
  const row = (kind: "early" | "final", f: DayFigures) => ({
    report_date: d.report_date,
    day: f.date,
    kind,
    spend: f.spend,
    revenue: f.revenue,
    nc_revenue: f.nc_revenue,
    purchases: f.purchases,
    meta_revenue: f.meta_revenue,
  });
  const { error } = await admin.from("daily_figures_log").insert([row("final", d.final.day), row("early", d.early.day)]);
  return error ? error.message : null;
}

// ---- Rendering ---------------------------------------------------------------

const tick = (nc: number | null, kpi: ResolvedKpi) => ((nc ?? 0) >= kpi.nc_roas_target ? " ✅" : "");
const dtcLabel = (x: { dtc: number | null }) => (x.dtc != null ? `DTC #${x.dtc}` : "no DTC #");

export function kpiLine(kpi: ResolvedKpi): string {
  const goal = kpi.goal ? ` (${kpi.goal})` : "";
  const base =
    `${monthName(kpi.for_month).split(" ")[0]} KPI${goal}: NC ROAS ≥ ${kpi.nc_roas_target} · min ${usd(kpi.min_spend)} to judge · ` +
    `potential ad = ${usd(kpi.potential_spend)} within ${kpi.potential_days} days`;
  if (kpi.source === "carried") return `${base}\n⚠️ No KPI set for ${monthName(kpi.for_month)}, so ${monthName(kpi.month)}'s is used. Set it in Settings → Monthly KPI.`;
  if (kpi.source === "legacy") return `${base}\n⚠️ No Monthly KPI set yet; using the Learnings rule.`;
  return base;
}

export function renderDailyReport(d: DailyReportData): DiscordMessage {
  const F = d.final.day, Fw = d.final.week_ago, E = d.early.day, Ew = d.early.week_ago;
  const short = (date: string) => weekday(date).slice(0, 3);
  const cpa = (f: DayFigures) => (f.purchases > 0 ? usd(f.spend / f.purchases) : "–");
  const noData = (f: DayFigures) => f.spend === 0;

  const fields: EmbedField[] = [];
  fields.push({
    name: `✅ ${weekday(F.date)} (${dmy(F.date)}) · final`,
    value: noData(F)
      ? "No Triple Whale data for this day yet."
      : `Data fully loaded (2 days ago). Compared with last ${weekday(Fw.date)} (${dm(Fw.date)}).`,
  });
  if (!noData(F)) {
    fields.push(
      { name: "Spend", value: `${usd(F.spend)}\n${delta(F.spend, Fw.spend)} · last ${short(Fw.date)} ${usd(Fw.spend)}`, inline: true },
      { name: "Revenue", value: `${usd(F.revenue)}\n${delta(F.revenue, Fw.revenue)} · last ${short(Fw.date)} ${usd(Fw.revenue)}`, inline: true },
      { name: "Purchases · CPA", value: `${Math.round(F.purchases).toLocaleString("en-US")} · ${cpa(F)}\nlast ${short(Fw.date)} ${Math.round(Fw.purchases).toLocaleString("en-US")} · ${cpa(Fw)}`, inline: true },
      { name: "ROAS", value: `${ratio(r2(F.revenue, F.spend))}\nlast ${short(Fw.date)} ${ratio(r2(Fw.revenue, Fw.spend))}`, inline: true },
      { name: "NC ROAS", value: `${ratio(r2(F.nc_revenue, F.spend))}${tick(r2(F.nc_revenue, F.spend), d.final_kpi)}\nlast ${short(Fw.date)} ${ratio(r2(Fw.nc_revenue, Fw.spend))} · KPI ${d.final_kpi.nc_roas_target}`, inline: true },
      { name: "Meta ROAS", value: `${ratio(r2(F.meta_revenue, F.spend))}\nlast ${short(Fw.date)} ${ratio(r2(Fw.meta_revenue, Fw.spend))}`, inline: true },
    );
  }

  fields.push({
    name: `⏳ ${weekday(E.date)} (${dmy(E.date)}) · early read`,
    value: noData(E)
      ? "No Triple Whale data for yesterday yet."
      : "Still loading. Spend is near-final; revenue and ROAS will move. Final numbers in tomorrow's report.",
  });
  if (!noData(E)) {
    fields.push(
      { name: "Spend", value: `${usd(E.spend)}\n${delta(E.spend, Ew.spend)} vs last ${short(Ew.date)}`, inline: true },
      { name: "ROAS (early)", value: ratio(r2(E.revenue, E.spend)), inline: true },
      { name: "NC ROAS (early)", value: ratio(r2(E.nc_revenue, E.spend)), inline: true },
    );
  }

  if (d.top_briefs.length) {
    fields.push({
      name: "Top spenders (briefs)",
      value: d.top_briefs
        .map((b, i) => `${i + 1}. **${b.dtc != null ? `DTC #${b.dtc}` : ""}** ${plain(b.name)} · ${usd(b.spend)} · NC ${ratio(b.nc_roas)}${tick(b.nc_roas, d.early_kpi)}`)
        .join("\n") + (d.unmatched_spend >= 500 ? `\n_${usd(d.unmatched_spend)} of yesterday's spend isn't matched to any brief._` : ""),
    });
  }

  fields.push({
    name: "📈 Growing vs yesterday (creatives Meta is scaling)",
    value: d.growing.length
      ? d.growing
          .map((g, i) => `${i + 1}. ${plain(g.ad_name)} (${dtcLabel(g)}) · ${usd(g.before)} → ${usd(g.spend)} **+${Math.round(g.growth * 100)}%** · NC ${ratio(g.nc_roas)}${tick(g.nc_roas, d.early_kpi)}`)
          .join("\n")
      : `Nothing grew ${Math.round(GROWTH_RULE.minGrowth * 100)}%+ from ${usd(GROWTH_RULE.minBefore)}+ yesterday.`,
  });

  const main: Embed = {
    title: `Daily report · ${weekday(d.report_date)} ${dmy(d.report_date)}`,
    description: kpiLine(d.early_kpi),
    color: COLOR.blue,
    fields,
  };

  const k = d.early_kpi;
  const creative = (x: DailyReportData["potential"][number], i: number) =>
    `${i + 1}. **${plain(x.ad_name)}** (${dtcLabel(x)})\n` +
    `Launched ${dm(x.launched)} · **${usd(x.spend)} in ${x.days} day${x.days === 1 ? "" : "s"}** · NC ROAS **${ratio(x.nc_roas)}**` +
    (x.url ? ` · [View ad ↗](${x.url})` : "");
  const potentialText = d.potential.length ? d.potential.map(creative).join("\n") : "None today.";
  const watchingText = d.watching.length
    ? d.watching
        .map((x) =>
          `${plain(x.ad_name)} (${dtcLabel(x)}) · ${usd(x.spend)} in ${x.days} day${x.days === 1 ? "" : "s"} · NC ${ratio(x.nc_roas)} · ` +
          `${usd(k.potential_spend - x.spend)} from the potential line` + (x.url ? ` · [View ad ↗](${x.url})` : ""))
        .join("\n")
    : "Nothing yet.";

  const potential: Embed = {
    title: "🚀 Potential ads",
    color: d.potential.length ? COLOR.orange : COLOR.grey,
    description:
      `_Launched in the last ${k.potential_days} days, ${usd(k.potential_spend)}+ spent at or above the KPI (NC ROAS ≥ ${k.nc_roas_target})._\n` +
      potentialText +
      `\n\n**👀 Watching**\n_Same, ${usd(k.watch_spend)}+ so far._\n` +
      watchingText,
    footer: {
      text:
        "Early numbers usually fade as Meta scales an ad: \"potential\" means worth a closer look, not a confirmed winner. " +
        "Store day = Adelaide time · Triple Whale, Triple Attribution (lifetime) · all ad accounts · ✅ = at or above KPI",
    },
  };

  return { embeds: [main, potential] };
}

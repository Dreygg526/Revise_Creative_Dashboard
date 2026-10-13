// Server-only: the creative hit rate, posted every other Monday to the
// creative leads' private channel (approved 2026-10-13, proposal v2).
//
// Briefs launched 2–8 weeks before the report, so each has had time to spend.
// Launch = the first day any of its Meta ads spent (the dashboard records no
// launch date). Each brief is judged on lifetime numbers to yesterday, under
// the Monthly KPI of the month it LAUNCHED, so changing November's KPI never
// rewrites September's winners.
//
//   Hit rate = winners ÷ (winners + losers). "Early" (under min spend) is
//   counted but never judged.
//
// Three tables: strategists (briefed to an editor), editors, and self-produced
// briefs (strategist == editor, see isSelfProduced) on their own. The
// Founder's own briefs are left out of the team report.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ad } from "@/app/types";
import { matchInsights } from "@/app/lib/metaMatch";
import { isSelfProduced } from "@/app/lib/gates";
import { fetchTripleWhaleLifetimeAds } from "@/app/lib/tripleWhale";
import { loadLegacyThresholds } from "@/app/lib/monthlyLearningsRun";
import { addDays, addMonths, loadKpis, monthName, resolveKpi, storeDate, verdictUnder } from "@/app/lib/kpi";
import { COLOR, dmy, monoTable, type DiscordMessage, type EmbedField } from "@/app/lib/discord";

export const HIT_RATE_WINDOW = { fromDaysAgo: 56, toDaysAgo: 14 };

// Every other Monday, counted from this one. 2026-10-19 is the first Monday
// after approval. Override with DISCORD_HITRATE_ANCHOR (any Monday, YYYY-MM-DD).
const DEFAULT_ANCHOR = "2026-10-19";

export function isHitRateDay(reportDate: string): boolean {
  const anchor = (process.env.DISCORD_HITRATE_ANCHOR || DEFAULT_ANCHOR).trim();
  const days = Math.round((Date.parse(`${reportDate}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000);
  return days >= 0 && days % 14 === 0;
}

export interface HitRow {
  name: string;
  briefs: number;
  winners: number;
  losers: number;
  early: number;
  hit_rate: number | null;
  winners_by_month: Record<string, number>;   // YYYY-MM → winners among ALL this person's briefs launched that month
}

export interface HitRateData {
  report_date: string;
  from: string;
  to: string;
  months: string[];          // the three "Winners:" columns
  strategists: HitRow[];
  editors: HitRow[];
  self_produced: HitRow[];
  rules: string[];           // e.g. "Aug 2026: NC ROAS ≥ 0.95 on ≥ $500"
}

interface Judged {
  ad: Ad;
  launched: string;
  verdict: "Winner" | "Loser" | "Too early";
}

function table(list: Judged[], key: (j: Judged) => string | null, from: string, to: string, months: string[]): HitRow[] {
  const groups = new Map<string, Judged[]>();
  for (const j of list) {
    const k = key(j)?.trim() || "Unassigned";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(j);
  }
  const rows: HitRow[] = [];
  for (const [name, all] of groups) {
    const inWindow = all.filter((j) => j.launched >= from && j.launched <= to);
    const winners_by_month: Record<string, number> = {};
    for (const m of months) winners_by_month[m] = all.filter((j) => j.verdict === "Winner" && j.launched.startsWith(m)).length;
    if (!inWindow.length && !Object.values(winners_by_month).some(Boolean)) continue;
    const w = inWindow.filter((j) => j.verdict === "Winner").length;
    const l = inWindow.filter((j) => j.verdict === "Loser").length;
    rows.push({
      name,
      briefs: inWindow.length,
      winners: w,
      losers: l,
      early: inWindow.filter((j) => j.verdict === "Too early").length,
      hit_rate: w + l > 0 ? w / (w + l) : null,
      winners_by_month,
    });
  }
  return rows.sort((a, b) => b.briefs - a.briefs || a.name.localeCompare(b.name));
}

export async function buildHitRate(admin: SupabaseClient, reportDate: string = storeDate()): Promise<HitRateData> {
  const asOf = addDays(reportDate, -1);
  const from = addDays(reportDate, -HIT_RATE_WINDOW.fromDaysAgo);
  const to = addDays(reportDate, -HIT_RATE_WINDOW.toDaysAgo);

  const [adsRes, teamRes, legacy, kpis, lifetime] = await Promise.all([
    admin.from("ads").select("*"),
    admin.from("team_members").select("name, role"),
    loadLegacyThresholds(admin),
    loadKpis(admin),
    fetchTripleWhaleLifetimeAds(asOf),
  ]);
  if (adsRes.error) throw new Error(`Couldn't load ads: ${adsRes.error.message}`);
  const ads = (adsRes.data ?? []) as Ad[];
  const founders = new Set((teamRes.data ?? []).filter((t) => t.role === "Founder").map((t) => String(t.name)));

  const byMeta = new Map(lifetime.map((r) => [r.ad_id, r]));
  const judged: Judged[] = [];
  for (const m of matchInsights(lifetime, ads).matches) {
    const ad = ads.find((a) => a.id === m.adId);
    if (!ad || (ad.assigned_strategist && founders.has(ad.assigned_strategist))) continue;
    const rows = m.metaAdIds.map((id) => byMeta.get(id)).filter((x) => !!x);
    if (!rows.length) continue;
    const launched = rows.map((r) => r!.first_spend).sort()[0];
    const spend = rows.reduce((s, r) => s + r!.spend, 0);
    const nc = rows.reduce((s, r) => s + r!.nc_revenue, 0);
    judged.push({ ad, launched, verdict: verdictUnder(resolveKpi(kpis, launched.slice(0, 7), legacy), spend, nc) });
  }

  const thisMonth = reportDate.slice(0, 7);
  const months = [addMonths(thisMonth, -2), addMonths(thisMonth, -1), thisMonth];
  const self = judged.filter((j) => isSelfProduced(j.ad));
  const briefed = judged.filter((j) => !isSelfProduced(j.ad));

  const ruleMonths = [...new Set([from.slice(0, 7), ...months])].sort();
  const rules = ruleMonths.map((m) => {
    const k = resolveKpi(kpis, m, legacy);
    return `${monthName(m, "short")}: NC ROAS ≥ ${k.nc_roas_target} on ≥ $${k.min_spend.toLocaleString("en-US")}`;
  });

  return {
    report_date: reportDate,
    from,
    to,
    months,
    strategists: table(briefed, (j) => j.ad.assigned_strategist, from, to, months),
    editors: table(briefed, (j) => j.ad.assigned_editor, from, to, months),
    self_produced: table(self, (j) => j.ad.assigned_strategist, from, to, months),
    rules,
  };
}

export function renderHitRate(d: HitRateData): DiscordMessage {
  const short = (m: string) => monthName(m, "short").split(" ")[0];
  const header = ["Name", "Briefs", "Win", "Lose", "Early", "Hit", "│", ...d.months.map(short)];
  const align: ("l" | "r")[] = ["l", "r", "r", "r", "r", "r", "l", ...d.months.map(() => "r" as const)];
  const block = (rows: HitRow[]) =>
    rows.length
      ? monoTable(
          header,
          rows.map((r) => [
            r.name.slice(0, 14), r.briefs, r.winners, r.losers, r.early,
            r.hit_rate == null ? "–" : `${Math.round(r.hit_rate * 100)}%`, "│",
            ...d.months.map((m) => r.winners_by_month[m] ?? 0),
          ]),
          align,
        )
      : "_No briefs in this window._";

  const fields: EmbedField[] = [
    { name: "Strategists (briefed to an editor)", value: block(d.strategists) },
    { name: "Editors", value: block(d.editors) },
    { name: "Self-produced (strategist made the creative)", value: block(d.self_produced) },
  ];

  return {
    embeds: [{
      title: `Creative hit rate · briefs launched ${dmy(d.from)} – ${dmy(d.to)}`,
      description:
        "Launched 2–8 weeks ago, so every brief has had time to spend. Each brief is judged by its launch month's KPI " +
        `(${d.rules.join(" · ")}), lifetime to yesterday. Hit rate = winners ÷ (winners + losers); "Early" = under the minimum spend so far, not judged. ` +
        `The month columns count winners by launch month across all of a person's briefs.`,
      color: COLOR.green,
      fields,
      footer: { text: "Every other Monday, 8:00 AM PH · Triple Whale, Triple Attribution (lifetime) · all ad accounts · Founder's own briefs not included" },
    }],
  };
}

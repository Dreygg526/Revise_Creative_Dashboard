// Server-only: fetch → build → summarise → save one month's learnings report.
// Shared by the button route (/api/monthly-learnings) and the monthly cron
// (/api/cron/monthly-learnings) so the two can never disagree about the rules.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ad } from "@/app/types";
import { fetchTripleWhaleLifetimeAds, fetchTripleWhalePeriodTotals } from "@/app/lib/tripleWhale";
import { buildMonthlyReport, monthBounds, type MonthlyReportData } from "@/app/lib/monthlyLearnings";

// Axel's numbers, 2026-10-04: "$500 … and 0.95 nc". Overridable per run and
// remembered in settings_targets so the next run (and the cron) reuse them.
export const DEFAULT_MIN_SPEND = 500;
export const DEFAULT_NC_TARGET = 0.95;
const KEY_MIN_SPEND = "learnings_min_spend";
const KEY_NC_TARGET = "learnings_nc_roas";

export const SummarySchema = z.object({
  headline: z.string(),
  what_worked: z.array(z.string()),
  what_didnt: z.array(z.string()),
  patterns: z.array(z.string()),
  next_month: z.array(z.string()),
});
export type LearningsSummary = z.infer<typeof SummarySchema>;

export async function loadThresholds(admin: SupabaseClient) {
  const { data } = await admin
    .from("settings_targets")
    .select("key, value")
    .in("key", [KEY_MIN_SPEND, KEY_NC_TARGET]);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  return {
    minSpend: Number(get(KEY_MIN_SPEND) ?? DEFAULT_MIN_SPEND),
    ncTarget: Number(get(KEY_NC_TARGET) ?? DEFAULT_NC_TARGET),
  };
}

async function saveThreshold(admin: SupabaseClient, key: string, value: number) {
  // settings_targets has no guaranteed unique index on key, so no upsert.
  const { data } = await admin.from("settings_targets").select("id").eq("key", key).limit(1);
  if (data && data.length) {
    await admin.from("settings_targets").update({ value }).eq("id", data[0].id);
  } else {
    await admin.from("settings_targets").insert({ key, value });
  }
}

export function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

const SYSTEM = `You write the monthly creative learnings for a DTC supplement brand's ad team (The Standard Lab — NAC-based liver/bloating/belly-fat products, sold through Meta ads).

You get one month's newly launched briefs as JSON. Each brief is a creative concept (a "DTC #") with several Meta ads under it, tagged with the strategy fields the team uses: persona, problem, core emotion, awareness, angle, ad type (Imitation / Ideation / Iteration / New Concept), format, strategist and editor.

The team's rule: a brief is a Winner when it spent at least min_spend and its NC ROAS (new-customer revenue ÷ spend) reached nc_roas_target. Below min_spend it is "Too early" and must not be called a winner or a loser.

Write for strategists who will read this in two minutes and decide what to make next month:
- Use only numbers present in the data. Never invent or estimate a figure.
- Refer to briefs as "DTC #N (name)".
- Prefer patterns across several briefs over single anecdotes, and say how many briefs a pattern rests on. Flag a bucket of 1–2 briefs as thin rather than presenting it as a finding.
- Compare against the account's own NC ROAS for the month when it helps — beating a weak month matters.
- Spend is a signal too: a brief Meta scaled to big spend at a decent NC ROAS matters more than a tiny one at a high ratio.
- "next_month" is concrete bets: what to iterate on, what to stop, what to test. 3–5 items.
- Each list item is one or two plain sentences. No markdown, no headers.`;

async function summarise(report: MonthlyReportData): Promise<LearningsSummary> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Trim to what the write-up needs; ids and creative-level ad ids are noise.
  const payload = {
    month: report.month,
    as_of: report.as_of,
    min_spend: report.min_spend,
    nc_roas_target: report.nc_roas_target,
    totals: report.totals,
    account_month: report.account,
    briefs: report.briefs.map((b) => ({
      dtc: b.dtc_number,
      name: b.name,
      verdict: b.verdict,
      launched: b.first_spend,
      spend: Math.round(b.spend),
      nc_roas: b.nc_roas == null ? null : +b.nc_roas.toFixed(2),
      roas: b.roas == null ? null : +b.roas.toFixed(2),
      cpa: b.cpa == null ? null : Math.round(b.cpa),
      meta_ads: b.meta_ads,
      persona: b.persona,
      problem: b.problem,
      core_emotion: b.core_emotion,
      awareness: b.awareness,
      angle: b.angle,
      ad_type: b.ad_type,
      format: b.format,
      product: b.product,
      strategist: b.strategist,
      editor: b.editor,
      top_creatives: b.top_creatives.map((c) => ({
        name: c.ad_name,
        spend: Math.round(c.spend),
        nc_roas: c.nc_roas == null ? null : +c.nc_roas.toFixed(2),
      })),
    })),
    tag_breakdown: report.tags.map((t) => ({
      ...t,
      spend: Math.round(t.spend),
      nc_roas: t.nc_roas == null ? null : +t.nc_roas.toFixed(2),
    })),
  };

  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(SummarySchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  if (response.stop_reason === "refusal") throw new Error("Claude declined to write this summary.");
  if (!response.parsed_output) throw new Error(`Summary came back unparseable (stop: ${response.stop_reason}).`);
  return response.parsed_output;
}

export interface RunResult {
  month: string;
  data: MonthlyReportData;
  summary: LearningsSummary | null;
  summary_error: string | null;
  saved: boolean;
  save_error: string | null;
}

export async function runMonthlyLearnings(
  admin: SupabaseClient,
  opts: { month: string; generatedBy: string; minSpend?: number; ncTarget?: number }
): Promise<RunResult> {
  const stored = await loadThresholds(admin);
  const minSpend = opts.minSpend ?? stored.minSpend;
  const ncTarget = opts.ncTarget ?? stored.ncTarget;
  if (opts.minSpend != null && opts.minSpend !== stored.minSpend) await saveThreshold(admin, KEY_MIN_SPEND, minSpend);
  if (opts.ncTarget != null && opts.ncTarget !== stored.ncTarget) await saveThreshold(admin, KEY_NC_TARGET, ncTarget);

  const asOf = yesterday();
  const { start, end } = monthBounds(opts.month);
  const accountEnd = end < asOf ? end : asOf;

  const [{ data: ads, error: adsErr }, rows, account] = await Promise.all([
    admin.from("ads").select("*"),
    fetchTripleWhaleLifetimeAds(asOf),
    fetchTripleWhalePeriodTotals(start, accountEnd),
  ]);
  if (adsErr) throw new Error(`Couldn't load ads: ${adsErr.message}`);

  const data = buildMonthlyReport({
    month: opts.month,
    asOf,
    minSpend,
    ncTarget,
    rows,
    ads: (ads ?? []) as Ad[],
    account,
  });

  let summary: LearningsSummary | null = null;
  let summaryError: string | null = null;
  if (data.briefs.length === 0) {
    summaryError = "No briefs started spending in this month, so there is nothing to summarise.";
  } else if (!process.env.ANTHROPIC_API_KEY) {
    summaryError = "Server is missing ANTHROPIC_API_KEY, so the written summary was skipped.";
  } else {
    try {
      summary = await summarise(data);
    } catch (e) {
      summaryError = e instanceof Error ? e.message : "The summary step failed.";
    }
  }

  // A missing table costs persistence, not the report — same spirit as the
  // v4/v5 column probes in meta-sync. The caller still gets everything.
  const { error: saveErr } = await admin.from("monthly_learnings").upsert({
    month: opts.month,
    generated_at: new Date().toISOString(),
    generated_by: opts.generatedBy,
    as_of: asOf,
    min_spend: minSpend,
    nc_roas_target: ncTarget,
    data,
    summary,
    summary_error: summaryError,
  });

  return {
    month: opts.month,
    data,
    summary,
    summary_error: summaryError,
    saved: !saveErr,
    save_error: saveErr
      ? /relation|does not exist|schema cache/i.test(saveErr.message)
        ? "The monthly_learnings table doesn't exist yet — run monthly_learnings_schema.sql in Supabase. This report was generated but not saved."
        : saveErr.message
      : null,
  };
}

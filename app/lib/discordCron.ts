// Server-only: the body of the Discord report crons, shared by the main run
// (/api/cron/discord, 09:00 UTC) and the catch-up run
// (/api/cron/discord/catchup, 11:00 UTC). See dailyReport.ts for why 09:00.
//
// Hardened 2026-10-23 after the 22 Oct daily report never posted: one Triple
// Whale query hung past its 55s timeout, the run gave up, and nobody knew until
// Axel asked. Three layers now, so a missed day needs Triple Whale to be out
// for two hours:
//   1. Each report tries up to 3 times (waits 20s, 40s) on a Triple Whale or
//      Discord 5xx / 429. Worst case 3 × 55s + 60s ≈ 225s, inside maxDuration 300.
//   2. If every attempt fails, a short notice goes to the report's channel so
//      the team hears it from us.
//   3. The catch-up run posts whatever is missing: the daily report if
//      daily_figures_log has no row for that store day, and on a hit-rate day
//      the hit rate if discord_post_log (discord_post_log_schema.sql) has none.
//      Rows are written only after Discord accepts the post, so "no row" means
//      "not posted". A log it can't read means "don't know", and it posts
//      nothing rather than risk a duplicate.

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCronSecret, serviceClient } from "@/app/lib/apiAuth";
import { activeProvider, TripleWhaleError } from "@/app/lib/tripleWhale";
import { storeDate } from "@/app/lib/kpi";
import { buildDailyReport, logDailyFigures, renderDailyReport } from "@/app/lib/dailyReport";
import { buildHitRate, isHitRateDay, renderHitRate } from "@/app/lib/hitRate";
import { postWebhook, webhookFor, DiscordError, type Channel, type DiscordMessage } from "@/app/lib/discord";

export const RETRY_WAITS_MS = [20_000, 40_000];
const CATCHUP_TIME = "7 PM Philippine time (11:00 UTC)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Worth another try: the far side was slow, down or rate-limiting. A 4xx such
// as a rejected query or a deleted webhook will fail the same way again.
function transient(e: unknown): boolean {
  return (e instanceof TripleWhaleError || e instanceof DiscordError) && (e.status >= 500 || e.status === 429);
}

async function withRetry<T>(label: string, fn: () => Promise<T>, waits: number[]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!transient(e) || attempt >= waits.length) throw e;
      console.warn(`[discord] ${label} attempt ${attempt + 1} failed, retrying in ${waits[attempt] / 1000}s: ${e instanceof Error ? e.message : e}`);
      await sleep(waits[attempt]);
    }
  }
}

// Already posted for this store day? null = couldn't tell (the caller must
// then NOT post, or a missing table would mean a duplicate every evening).
async function alreadyPosted(admin: SupabaseClient, report: "daily" | "hitrate", date: string): Promise<boolean | null> {
  const { data, error } = report === "daily"
    ? await admin.from("daily_figures_log").select("id").eq("report_date", date).eq("kind", "final").limit(1)
    : await admin.from("discord_post_log").select("id").eq("report", "hitrate").eq("report_date", date).limit(1);
  if (error) {
    console.error(`[discord] catch-up couldn't read the ${report} log`, error.message);
    return null;
  }
  return (data?.length ?? 0) > 0;
}

// The hit rate's "it went out" record. Missing table = no record, never a
// failed post (until discord_post_log_schema.sql is run, the catch-up just
// can't cover the hit rate).
async function logHitRate(admin: SupabaseClient, date: string, messageId: string | null): Promise<string | null> {
  const { error } = await admin.from("discord_post_log").insert([{ report: "hitrate", report_date: date, message_id: messageId }]);
  return error ? error.message : null;
}

function failureNotice(job: "daily" | "hitrate", e: unknown, catchup: boolean): DiscordMessage {
  const what = job === "daily" ? "Today's daily report" : "This week's hit rate";
  const why = e instanceof TripleWhaleError
    ? `Triple Whale isn't responding (tried ${RETRY_WAITS_MS.length + 1} times)`
    : "it hit an error (details in the Vercel log)";
  const next = !catchup
    ? `It will try again automatically at ${CATCHUP_TIME}.`
    : "It will be posted by hand once this is fixed.";
  return { content: `⚠️ ${what} didn't go out: ${why}. ${next}`, embeds: [] };
}

export async function runDiscordCron(req: Request, opts: { catchup: boolean; waits?: number[] }): Promise<Response> {
  const auth = requireCronSecret(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const admin = serviceClient();
  if (!admin) return Response.json({ error: "Server is missing the service role key." }, { status: 500 });
  if (activeProvider() !== "triple_whale") {
    return Response.json({ error: "TRIPLE_WHALE_API_KEY is not set." }, { status: 400 });
  }

  const url = new URL(req.url);
  const kind = opts.catchup ? "auto" : url.searchParams.get("kind") || "auto";
  const dry = url.searchParams.get("dry") === "1";
  const date = url.searchParams.get("date") || storeDate();
  const waits = opts.waits ?? RETRY_WAITS_MS;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  if (!["auto", "daily", "hitrate"].includes(kind)) return Response.json({ error: "kind must be daily, hitrate or auto." }, { status: 400 });

  const wantDaily = kind === "auto" || kind === "daily";
  const wantHitRate = kind === "hitrate" || (kind === "auto" && isHitRateDay(date));

  // Catch-up: keep only what hasn't gone out. Anything it can't check is
  // skipped (and reported), never posted blind.
  const skipped: { report: string; ok: boolean; posted: false; skipped: string }[] = [];
  let runDaily = wantDaily, runHitRate = wantHitRate;
  if (opts.catchup) {
    for (const report of ["daily", "hitrate"] as const) {
      if (report === "daily" ? !wantDaily : !wantHitRate) continue;
      const posted = await alreadyPosted(admin, report, date);
      if (posted === false) continue;
      skipped.push({
        report,
        ok: posted === true,
        posted: false,
        skipped: posted ? "already posted" : `couldn't read the ${report === "daily" ? "daily_figures_log" : "discord_post_log"} table, so nothing was posted`,
      });
      if (report === "daily") runDaily = false; else runHitRate = false;
    }
  }

  const jobs: { name: "daily" | "hitrate"; channel: Channel; build: () => Promise<{ msg: DiscordMessage; log?: (messageId: string | null) => Promise<string | null> }> }[] = [];
  if (runDaily) {
    jobs.push({
      name: "daily",
      channel: "daily",
      build: async () => {
        const data = await buildDailyReport(admin, date);
        return { msg: renderDailyReport(data), log: () => logDailyFigures(admin, data) };
      },
    });
  }
  if (runHitRate) {
    jobs.push({
      name: "hitrate",
      channel: "leads",
      build: async () => ({ msg: renderHitRate(await buildHitRate(admin, date)), log: (messageId) => logHitRate(admin, date, messageId) }),
    });
  }

  // Each report independently: a failed hit rate must not cost the daily one.
  const results = await Promise.all(
    jobs.map(async (job) => {
      const hook = webhookFor(job.channel);
      try {
        const { msg, log } = await withRetry(`${job.name} build`, job.build, waits);
        if (dry) return { report: job.name, ok: true, posted: false, message: msg };
        if (!hook.url) {
          return { report: job.name, ok: false, error: `No webhook set for this report (${job.channel === "daily" ? "DISCORD_WEBHOOK_DAILY_REPORT" : "DISCORD_WEBHOOK_CREATIVE_LEADS"}).` };
        }
        const posted = await withRetry(`${job.name} post`, () => postWebhook(hook.url!, msg), waits);
        const logError = log ? await log(posted.id) : null;
        return { report: job.name, ok: true, posted: true, test_channel: hook.test, message_id: posted.id, log_error: logError };
      } catch (e) {
        const status = e instanceof TripleWhaleError || e instanceof DiscordError ? e.status : 500;
        console.error(`[discord] ${job.name} failed${opts.catchup ? " (catch-up)" : ""}`, e);
        let notified = false;
        if (!dry && hook.url) {
          try {
            await postWebhook(hook.url, failureNotice(job.name, e, opts.catchup));
            notified = true;
          } catch (n) {
            console.error(`[discord] ${job.name} failure notice failed too`, n);
          }
        }
        return { report: job.name, ok: false, status, error: e instanceof Error ? e.message : "Unexpected error.", notified };
      }
    })
  );

  const all = [...skipped, ...results];
  const allOk = all.every((r) => r.ok);
  return Response.json({ ok: allOk, date, catchup: opts.catchup, results: all }, { status: allOk ? 200 : 502 });
}

import { NextResponse } from "next/server";
import { requireCronSecret, serviceClient } from "@/app/lib/apiAuth";
import { activeProvider, TripleWhaleError } from "@/app/lib/tripleWhale";
import { storeDate } from "@/app/lib/kpi";
import { buildDailyReport, logDailyFigures, renderDailyReport } from "@/app/lib/dailyReport";
import { buildHitRate, isHitRateDay, renderHitRate } from "@/app/lib/hitRate";
import { postWebhook, webhookFor, DiscordError, type Channel, type DiscordMessage } from "@/app/lib/discord";

// The Discord reports (approved 2026-10-13). One Vercel Cron, daily at 09:00
// UTC = 5:00 PM Philippines = 2 AM Los Angeles, once the ad account's (LA)
// day is over so yesterday is complete (moved from 8 AM PH 2026-10-20, see
// dailyReport.ts): the daily report every day,
// plus the hit rate every Monday. One cron rather than two keeps it
// inside any plan's cron limits and on one clock.
//
// Manual runs, with the same CRON_SECRET:
//   ?kind=daily | hitrate | auto (default)   which report(s)
//   &date=YYYY-MM-DD                          pretend today is this store day
//   &dry=1                                    build and return, post nothing, log nothing
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = requireCronSecret(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
  if (activeProvider() !== "triple_whale") {
    return NextResponse.json({ error: "TRIPLE_WHALE_API_KEY is not set." }, { status: 400 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "auto";
  const dry = url.searchParams.get("dry") === "1";
  const date = url.searchParams.get("date") || storeDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  if (!["auto", "daily", "hitrate"].includes(kind)) return NextResponse.json({ error: "kind must be daily, hitrate or auto." }, { status: 400 });

  const jobs: { name: string; channel: Channel; build: () => Promise<{ msg: DiscordMessage; log?: () => Promise<string | null> }> }[] = [];
  if (kind === "auto" || kind === "daily") {
    jobs.push({
      name: "daily",
      channel: "daily",
      build: async () => {
        const data = await buildDailyReport(admin, date);
        return { msg: renderDailyReport(data), log: () => logDailyFigures(admin, data) };
      },
    });
  }
  if (kind === "hitrate" || (kind === "auto" && isHitRateDay(date))) {
    jobs.push({ name: "hitrate", channel: "leads", build: async () => ({ msg: renderHitRate(await buildHitRate(admin, date)) }) });
  }

  // Each report independently: a failed hit rate must not cost the daily one.
  const results = await Promise.all(
    jobs.map(async (job) => {
      try {
        const { msg, log } = await job.build();
        if (dry) return { report: job.name, ok: true, posted: false, message: msg };
        const hook = webhookFor(job.channel);
        if (!hook.url) {
          return { report: job.name, ok: false, error: `No webhook set for this report (${job.channel === "daily" ? "DISCORD_WEBHOOK_DAILY_REPORT" : "DISCORD_WEBHOOK_CREATIVE_LEADS"}).` };
        }
        const posted = await postWebhook(hook.url, msg);
        const logError = log ? await log() : null;
        return { report: job.name, ok: true, posted: true, test_channel: hook.test, message_id: posted.id, log_error: logError };
      } catch (e) {
        const status = e instanceof TripleWhaleError || e instanceof DiscordError ? e.status : 500;
        console.error(`[discord] ${job.name} failed`, e);
        return { report: job.name, ok: false, status, error: e instanceof Error ? e.message : "Unexpected error." };
      }
    })
  );

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ ok: allOk, date, results }, { status: allOk ? 200 : 502 });
}

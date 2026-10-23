import { runDiscordCron } from "@/app/lib/discordCron";

// The Discord reports (approved 2026-10-13). One Vercel Cron, daily at 09:00
// UTC = 5:00 PM Philippines = 2 AM Los Angeles, once the ad account's (LA)
// day is over so yesterday is complete (moved from 8 AM PH 2026-10-20, see
// dailyReport.ts): the daily report every day,
// plus the hit rate every Monday. Retries, failure notices and the 11:00 UTC
// catch-up run live in app/lib/discordCron.ts.
//
// Manual runs, with the same CRON_SECRET:
//   ?kind=daily | hitrate | auto (default)   which report(s)
//   &date=YYYY-MM-DD                          pretend today is this store day
//   &dry=1                                    build and return, post nothing, log nothing
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runDiscordCron(req, { catchup: false });
}

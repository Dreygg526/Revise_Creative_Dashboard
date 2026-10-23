import { runDiscordCron } from "@/app/lib/discordCron";

// Catch-up for the daily report, scheduled at 11:00 UTC = 7 PM Philippines,
// two hours after the main run. Posts only when daily_figures_log has no row
// for today's store day, so on a normal day it does nothing. Same CRON_SECRET;
// takes &date=YYYY-MM-DD and &dry=1 like the main route.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runDiscordCron(req, { catchup: true });
}

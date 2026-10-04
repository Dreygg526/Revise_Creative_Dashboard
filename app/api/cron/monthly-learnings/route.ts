import { NextResponse } from "next/server";
import { requireCronSecret, serviceClient } from "@/app/lib/apiAuth";
import { activeProvider, TripleWhaleError } from "@/app/lib/tripleWhale";
import { runMonthlyLearnings } from "@/app/lib/monthlyLearningsRun";
import { previousMonth } from "@/app/lib/monthlyLearnings";

// Vercel Cron, scheduled in vercel.json for the 2nd of every month — the 2nd
// rather than the 1st so the month's last day has finished filling in Triple
// Whale. Writes last month's report with the saved thresholds; anyone can
// regenerate it later from the Learnings view as numbers mature.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  const auth = requireCronSecret(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const admin = serviceClient();
    if (!admin) return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
    if (activeProvider() !== "triple_whale") {
      return NextResponse.json({ error: "TRIPLE_WHALE_API_KEY is not set." }, { status: 400 });
    }

    const url = new URL(req.url);
    const month = url.searchParams.get("month") || previousMonth(new Date());
    const r = await runMonthlyLearnings(admin, { month, generatedBy: "cron" });
    return NextResponse.json({
      ok: true,
      month: r.month,
      launched: r.data.launched.totals.briefs,
      created: r.data.created.totals.briefs,
      winners: r.data.launched.totals.winners,
      saved: r.saved,
      save_error: r.save_error,
      summary_error: r.summary_error,
    });
  } catch (e) {
    const status = e instanceof TripleWhaleError ? e.status : 500;
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status });
  }
}

import { NextResponse } from "next/server";
import { requireMember, serviceClient } from "@/app/lib/apiAuth";
import { activeProvider, TripleWhaleError } from "@/app/lib/tripleWhale";
import { buildStrategistReport, STRATEGIST_WINDOWS } from "@/app/lib/strategistPerf";

// Per-strategist performance for the Strategists view. Read-only, so any
// signed-in member; it holds the Triple Whale key, so never anonymous.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const admin = serviceClient();
    if (!admin) return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });

    // Verify the caller before reporting anything about server config.
    const auth = await requireMember(req, admin, null);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    if (activeProvider() !== "triple_whale") {
      return NextResponse.json({ error: "Strategist performance needs Triple Whale (TRIPLE_WHALE_API_KEY)." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const days = Number(body?.days);
    if (!STRATEGIST_WINDOWS.includes(days as (typeof STRATEGIST_WINDOWS)[number])) {
      return NextResponse.json({ error: `days must be one of ${STRATEGIST_WINDOWS.join(", ")}.` }, { status: 400 });
    }

    const report = await buildStrategistReport(admin, days);
    return NextResponse.json({ ok: true, report });
  } catch (e) {
    if (e instanceof TripleWhaleError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

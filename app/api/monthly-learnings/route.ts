import { NextResponse } from "next/server";
import { requireMember, serviceClient } from "@/app/lib/apiAuth";
import { can } from "@/app/lib/permissions";
import { activeProvider, TripleWhaleError } from "@/app/lib/tripleWhale";
import { runMonthlyLearnings, yesterday } from "@/app/lib/monthlyLearningsRun";

// Generate (or regenerate) one month's learnings report on demand. Saved
// reports are read straight from the table by the browser; this route exists
// only because generating needs the Triple Whale and Anthropic keys.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const admin = serviceClient();
    if (!admin) {
      return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
    }

    // Any signed-in member can generate — it only reads, and costs one
    // Claude call. Changing the verdict thresholds is gated below.
    const auth = await requireMember(req, admin, null);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    if (activeProvider() !== "triple_whale") {
      return NextResponse.json(
        { error: "Monthly learnings need Triple Whale (TRIPLE_WHALE_API_KEY) — it's the only source with new-customer revenue per ad." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const month = String(body?.month ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: "month must look like 2026-09." }, { status: 400 });
    }
    if (`${month}-01` > yesterday()) {
      return NextResponse.json({ error: "That month hasn't started yet." }, { status: 400 });
    }

    const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    const minSpend = num(body?.minSpend);
    const ncTarget = num(body?.ncTarget);
    if (minSpend !== undefined && !(Number.isFinite(minSpend) && minSpend >= 0)) {
      return NextResponse.json({ error: "Minimum spend must be a number ≥ 0." }, { status: 400 });
    }
    if (ncTarget !== undefined && !(Number.isFinite(ncTarget) && ncTarget > 0 && ncTarget < 20)) {
      return NextResponse.json({ error: "NC ROAS target must be a number like 0.95." }, { status: 400 });
    }
    if ((minSpend !== undefined || ncTarget !== undefined) && !can(auth.role, "edit_performance")) {
      return NextResponse.json({ error: "Only Founders, Strategists and Media Buyers can change the winner rule." }, { status: 403 });
    }

    const result = await runMonthlyLearnings(admin, { month, generatedBy: auth.email, minSpend, ncTarget });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof TripleWhaleError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

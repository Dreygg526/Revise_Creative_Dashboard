import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { activeProvider, fetchTripleWhaleDaily, TripleWhaleError } from "@/app/lib/tripleWhale";

// Account-level daily performance for the KPI tiles: the selected window and
// the equal-length window before it, so each tile can draw a sparkline and a
// delta. Read-only, but it still holds the Triple Whale key, so it must not
// be openly callable — same session check as /api/meta-sync, minus the
// edit_performance requirement since nothing here writes.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!serviceKey) {
      return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
    }

    // Verify the caller before reporting anything about server config.
    const accessToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
    if (userErr || !userData?.user?.email) {
      return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
    }

    if (activeProvider() !== "triple_whale") {
      // Meta's insights API has no equivalent single call for this, and the
      // tiles degrade to plain numbers without it. Not an error.
      return NextResponse.json({ ok: true, unavailable: "meta", current: [], previous: [] });
    }

    const body = await req.json().catch(() => ({}));
    const datePreset: string = body?.datePreset || "last_30d";

    const { current, previous } = await fetchTripleWhaleDaily(datePreset);
    return NextResponse.json({ ok: true, datePreset, current, previous });
  } catch (e) {
    if (e instanceof TripleWhaleError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

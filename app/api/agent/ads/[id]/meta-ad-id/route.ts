// ============================================================
// AGENT API — the one write the agent key is allowed to make.
//
//   POST /api/agent/ads/<ad id>/meta-ad-id
//   Authorization: Bearer <AGENT_API_KEY>
//   { "meta_ad_id": "120210000000000000" }   (null clears it)
//
// After OpenClaw launches an ad on Meta, Meta hands back an ad id. Writing
// it here makes the next sync exact: `ads.meta_ad_id` is the TOP-precedence
// candidate in matchInsights(), ahead of every name-parsing rule. Without
// it we're inferring the link from `DTC #82`-style strings — which works,
// but is inference.
//
// This route can write exactly one column. It cannot touch stage, spend,
// assignments, or anything else, so a compromised agent key still can't
// move work through the pipeline or alter a brief.
// ============================================================

import { NextResponse } from "next/server";
import { requireAgentKey, serviceClient } from "@/app/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Meta ad ids are long numeric strings. Anything else is a caller bug —
// and silently storing it would poison the matcher's highest-priority rule.
const META_AD_ID_RE = /^\d{5,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = requireAgentKey(req);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: "Ad id must be a UUID (the `id` field from GET /api/agent/ads)." },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || !("meta_ad_id" in body)) {
      return NextResponse.json(
        { error: 'Body must be JSON with a "meta_ad_id" field.' },
        { status: 400 }
      );
    }

    const raw = body.meta_ad_id;
    let metaAdId: string | null;

    if (raw === null || raw === "") {
      metaAdId = null;
    } else if (typeof raw === "string" && META_AD_ID_RE.test(raw.trim())) {
      metaAdId = raw.trim();
    } else if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
      // Meta ids exceed Number.MAX_SAFE_INTEGER, so a JSON number may already
      // have lost precision before it reached us. Reject rather than store a
      // silently wrong id.
      return NextResponse.json(
        {
          error:
            "Send meta_ad_id as a string, not a number — Meta ad ids are longer " +
            "than JSON can represent exactly.",
        },
        { status: 400 }
      );
    } else {
      return NextResponse.json(
        { error: "meta_ad_id must be a numeric string (5-32 digits), or null to clear it." },
        { status: 400 }
      );
    }

    const admin = serviceClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Server is missing Supabase credentials." },
        { status: 500 }
      );
    }

    const { data, error } = await admin
      .from("ads")
      .update({ meta_ad_id: metaAdId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, dtc_number, ad_name, meta_ad_id")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "No ad with that id." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ad: data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ============================================================
// AGENT API — read the pipeline from outside the browser.
//
// Built for Axel's OpenClaw: it polls "what's in Ready to Launch?" and
// launches those ads to Meta itself. The dashboard has no write access to
// Meta and isn't gaining any here — this route only reads.
//
//   GET /api/agent/ads?stage=Ready%20to%20Launch
//   Authorization: Bearer <AGENT_API_KEY>
//
// Query params (all optional):
//   stage  — pipeline stage to filter on. Default "Ready to Launch".
//            Pass "*" for every stage.
//   dtc    — a single DTC number. NOTE: dtc_number is not unique (#31 is
//            duplicated), so this can return more than one row.
//   since  — ISO timestamp; only ads updated at or after it. Lets a poller
//            ask for "what changed since my last run" instead of everything.
//   limit  — 1..500, default 100.
//
// The response is an explicit allow-list, not `select("*")`. A new column
// on `ads` has to be added here before it leaves the building — that keeps
// close-out numbers, learnings and the meta_* roll-ups out of an integration
// that has no reason to see them.
// ============================================================

import { NextResponse } from "next/server";
import { requireAgentKey, serviceClient } from "@/app/lib/apiAuth";

export const runtime = "nodejs";
// Header-dependent and always live — never serve a cached pipeline.
export const dynamic = "force-dynamic";

const DEFAULT_STAGE = "Ready to Launch";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const FIELDS = [
  "id",
  "dtc_number",
  "ad_name",
  "product",
  "stage",
  // The verdict only — not spend/purchases/cvr/learning. It's here because
  // the agent writes it via POST .../result and needs to read back what it
  // set (and what a human set) to stay idempotent.
  "result",
  "priority",
  "format",
  "ad_type",
  "content_source",
  "persona",
  "sub_avatar",
  "angle",
  "concept",
  "core_emotion",
  "problem",
  "awareness",
  "selected_headline",
  "selected_ad_copy",
  "script_hook",
  "destination_url",
  "destination_urls",
  "whitelisting_pages",
  "frame_io_link",
  "brief_link",
  "assigned_strategist",
  "assigned_editor",
  "assigned_media_buyer",
  "assigned_designer",
  "due_date",
  "notes",
  "meta_ad_id",
  "updated_at",
].join(", ");

interface AgentAdRow {
  id: string;
  dtc_number: number | null;
  destination_url: string | null;
  destination_urls: string[] | null;
  frame_io_link: string | null;
  [key: string]: unknown;
}

export async function GET(req: Request) {
  try {
    // Authenticate first — before touching config or the database.
    const auth = requireAgentKey(req);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const admin = serviceClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Server is missing Supabase credentials." },
        { status: 500 }
      );
    }

    const params = new URL(req.url).searchParams;
    const stage = params.get("stage") ?? DEFAULT_STAGE;
    const dtc = params.get("dtc");
    const since = params.get("since");

    const limitRaw = Number(params.get("limit"));
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
        : DEFAULT_LIMIT;

    let query = admin
      .from("ads")
      .select(FIELDS)
      .order("dtc_number", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (stage !== "*") query = query.eq("stage", stage);

    if (dtc !== null) {
      const n = Number(dtc);
      if (!Number.isFinite(n)) {
        return NextResponse.json(
          { error: `"dtc" must be a number — got "${dtc}".` },
          { status: 400 }
        );
      }
      query = query.eq("dtc_number", n);
    }

    if (since) {
      if (Number.isNaN(Date.parse(since))) {
        return NextResponse.json(
          { error: `"since" must be an ISO timestamp — got "${since}".` },
          { status: 400 }
        );
      }
      query = query.gte("updated_at", since);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as AgentAdRow[];

    const ads = rows.map((row) => ({
      ...row,
      // destination_urls is the live field and destination_url is the legacy
      // single. A launcher needs one URL, so resolve the precedence here
      // rather than making every caller reimplement it.
      destination_url_primary:
        (Array.isArray(row.destination_urls) && row.destination_urls[0]) ||
        row.destination_url ||
        null,
      // The creative file itself is NOT in this database — frame_io_link
      // points at it. Fetching the asset needs Frame.io credentials.
      creative_asset: {
        location: "frame.io",
        link: row.frame_io_link,
        note: "Link only. The dashboard does not store the video or image file.",
      },
    }));

    return NextResponse.json({
      ok: true,
      stage,
      count: ads.length,
      limit,
      truncated: ads.length === limit,
      ads,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

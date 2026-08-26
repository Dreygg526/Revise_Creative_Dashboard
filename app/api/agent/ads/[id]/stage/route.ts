// ============================================================
// AGENT API — move an ad forward through the pipeline.
//
//   POST /api/agent/ads/<ad id>/stage
//   Authorization: Bearer <AGENT_API_KEY>
//   { "stage": "Testing" }
//
// Built 2026-08-26 on Axel's report that OpenClaw "can't move it from ready
// to launch to testing". It launches the ad to Meta, so it is the only thing
// that knows the launch happened; leaving the ad parked in Ready to Launch
// meant a person had to go tick a box for work a machine had already done.
//
// TWO BOUNDS, both deliberate:
//
// 1. FORWARD ONLY. A move to an earlier stage is refused. This is what's
//    left of the original "a compromised key can't pull work backwards
//    through the pipeline" property, and it's worth keeping: an agent that
//    can rewind can quietly undo a team's work and make the board lie. A
//    same-stage post is a no-op, not an error, so a retrying poller is safe.
//
// 2. GATES ARE ENFORCED. checkMove() from gates.ts runs exactly as it does
//    for a person, and a blocked move returns 409 with the missing fields
//    named. The agent gets no privilege a strategist doesn't have. This is
//    the opposite of the sibling .../result route, which deliberately skips
//    the close-out gate — the difference is that that gate guards a data-entry
//    form the agent has already satisfied by other means, whereas these gates
//    guard real prerequisites (no destination URL means there is nothing to
//    launch to).
//
// Closing an ad out still belongs to POST .../result, not here: the terminal
// move carries a verdict and numbers with it. Posting stage "Winner / Killed"
// here works, but only if the close-out gate is already satisfied — which in
// practice means calling .../result first anyway.
// ============================================================

import { NextResponse } from "next/server";
import { requireAgentKey, serviceClient } from "@/app/lib/apiAuth";
import { STAGE_ORDER, checkMove, stageIndex } from "@/app/lib/gates";
import type { Ad } from "@/app/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only the fields the gates actually read, plus what the response echoes.
// Same allow-list discipline as GET /api/agent/ads — a new column doesn't
// become visible to the integration by accident.
const ROW_FIELDS = [
  "id",
  "dtc_number",
  "ad_name",
  "stage",
  // Idea -> Brief
  "persona",
  "core_emotion",
  "problem",
  "awareness",
  // Brief -> In Production (and isSelfProduced)
  "brief_link",
  "assigned_strategist",
  "assigned_editor",
  // Ready to Launch -> Testing
  "destination_urls",
  // Testing -> Winner / Killed
  "result",
  "spend",
  "purchases",
  "cvr",
  "learning",
].join(", ");

// Resolve a caller's spelling to the canonical stage string. The stored value
// has to match STAGE_ORDER exactly — the board groups columns by string
// equality, so "testing" would create a phantom column no filter reaches.
function canonicalStage(input: string): string | null {
  const cleaned = input.trim().toLowerCase().replace(/\s+/g, " ");
  for (const stage of STAGE_ORDER) {
    if (stage.toLowerCase() === cleaned) return stage;
  }
  // "Winner/Killed", "winner - killed", "winner killed" all mean the terminal
  // stage. Compare on letters only so the separator stops mattering.
  const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  for (const stage of STAGE_ORDER) {
    if (letters(stage) === letters(input)) return stage;
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authenticate before touching config or the database.
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
    }

    const fields = body as Record<string, unknown>;
    const rawStage = fields.stage;

    if (typeof rawStage !== "string" || !rawStage.trim()) {
      return NextResponse.json(
        {
          error: 'Body must be JSON with a "stage" string.',
          valid_stages: STAGE_ORDER,
        },
        { status: 400 }
      );
    }

    const target = canonicalStage(rawStage);
    if (!target) {
      return NextResponse.json(
        {
          error:
            'Unknown stage "' + rawStage.trim() + '". Stages are fixed — the ' +
            "pipeline order below is the only vocabulary.",
          valid_stages: STAGE_ORDER,
        },
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

    const { data: before, error: readErr } = await admin
      .from("ads")
      .select(ROW_FIELDS)
      .eq("id", id)
      .maybeSingle();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    if (!before) {
      return NextResponse.json({ error: "No ad with that id." }, { status: 404 });
    }

    const ad = before as unknown as Ad;
    const from = ad.stage;

    // A poller that retries, or that recomputes the same decision twice,
    // lands here. Not an error — report the no-op and move on.
    if (from === target) {
      return NextResponse.json({
        ok: true,
        ad: { id: ad.id, dtc_number: ad.dtc_number, ad_name: ad.ad_name, stage: from },
        moved: false,
        note: 'Already in "' + target + '" — nothing changed.',
      });
    }

    const fromIdx = stageIndex(from);
    if (fromIdx === -1) {
      // The row carries a stage that isn't in STAGE_ORDER, so "forward" has no
      // meaning and the gates can't be evaluated. Refuse rather than guess.
      return NextResponse.json(
        {
          error:
            'This ad sits in "' + from + '", which is not one of the pipeline ' +
            "stages, so the direction of the move can't be determined. A person " +
            "needs to fix it in the dashboard.",
          valid_stages: STAGE_ORDER,
        },
        { status: 409 }
      );
    }

    if (stageIndex(target) < fromIdx) {
      return NextResponse.json(
        {
          error:
            "The agent key can only move ads forward. This ad is in \"" + from +
            '" and "' + target + '" is earlier in the pipeline. A person can move ' +
            "it back from the ad detail modal.",
          from,
          to: target,
        },
        { status: 403 }
      );
    }

    // Same gates a person hits, evaluated on the row we just read.
    const gate = checkMove(ad, from, target);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          error:
            'Can\'t move "' + from + '" -> "' + target + '": ' +
            gate.missing.join(", ") + " missing.",
          from,
          to: target,
          missing: gate.missing,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const { data: after, error: writeErr } = await admin
      .from("ads")
      .update({ stage: target, updated_at: now })
      .eq("id", id)
      .select("id, dtc_number, ad_name, stage")
      .maybeSingle();

    if (writeErr) {
      return NextResponse.json({ error: writeErr.message }, { status: 500 });
    }
    if (!after) {
      return NextResponse.json({ error: "No ad with that id." }, { status: 404 });
    }

    const warnings: string[] = [];
    if (target === "Winner / Killed") {
      warnings.push(
        "Moved straight to the terminal stage. POST .../result is the endpoint " +
          "that records the verdict, spend, purchases, CVR and learning behind it."
      );
    }

    return NextResponse.json({
      ok: true,
      ad: after,
      moved: true,
      stage_changed: { from, to: target },
      // Openly reported so a caller with a stale list can tell a real advance
      // from a stage it skipped past.
      skipped_stages: STAGE_ORDER.slice(fromIdx + 1, stageIndex(target)),
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

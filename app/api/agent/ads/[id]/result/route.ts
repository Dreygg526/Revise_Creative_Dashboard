// ============================================================
// AGENT API — rank an ad Winner or Killed.
//
//   POST /api/agent/ads/<ad id>/result
//   Authorization: Bearer <AGENT_API_KEY>
//   { "result": "Winner" }                       tag it, leave it where it is
//   { "result": "Killed", "close": true }        tag it AND close it out
//   { "result": "Winner", "learning": "…" }      tag it and record why
//   { "result": null }                           clear the verdict
//
// Axel's OpenClaw watches the ads it launched and knows which ones worked.
// Nothing was writing that back: 0 of 99 ads carry a `result`, which is why
// the Learnings view is empty and the Win rate column was pulled from
// Analytics. This is the endpoint that closes that loop.
//
// SCOPE — this widens the agent key beyond the single meta_ad_id column, so
// the new bound is worth stating exactly. This route can write `result`,
// `learning`, and `stage` — but the ONLY stage value it can ever write is
// "Winner / Killed", the terminal one. It cannot pull an ad back into
// Production, reassign it, retitle it, touch spend, or delete anything. A
// hijacked key can mislabel outcomes (reversible from the modal, and stamped
// `result_source = 'agent'` so its writes are findable) — it still can't move
// work through the pipeline.
//
// It deliberately does NOT enforce the Testing -> Winner/Killed gate from
// gates.ts. That gate exists to stop a person clicking past the close-out
// form; a machine posting a verdict it measured on Meta is a different act,
// and the spend/purchase numbers the form asks for are already on the row
// from the sync. Closing with no learning is reported back as a warning
// rather than refused.
// ============================================================

import { NextResponse } from "next/server";
import { requireAgentKey, serviceClient } from "@/app/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The one and only stage this route can write. Keeping it a constant rather
// than a body parameter is what keeps "the agent can't move work through the
// pipeline" true.
const CLOSED_STAGE = "Winner / Killed";

const LEARNING_MAX = 2000;

// The dashboard's vocabulary is Winner / Killed — that exact casing is what
// CloseOutModal, LearningsView, ReportsView and the pipeline badge match on.
// Callers say "loser". Accept the synonyms and store the canonical value: a
// near-miss spelling written straight through would sit in the column looking
// correct while every screen ignored it.
const RESULT_SYNONYMS: Record<string, "Winner" | "Killed"> = {
  winner: "Winner",
  win: "Winner",
  won: "Winner",
  w: "Winner",
  killed: "Killed",
  kill: "Killed",
  loser: "Killed",
  looser: "Killed",
  lose: "Killed",
  loss: "Killed",
  lost: "Killed",
  dead: "Killed",
  l: "Killed",
};

interface AdRow {
  id: string;
  dtc_number: number | null;
  ad_name: string | null;
  stage: string;
  result: string | null;
  learning: string | null;
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
    if (!body || typeof body !== "object" || !("result" in body)) {
      return NextResponse.json(
        { error: 'Body must be JSON with a "result" field ("Winner", "Killed", or null).' },
        { status: 400 }
      );
    }

    const fields = body as Record<string, unknown>;

    // ---- result ----
    const rawResult = fields.result;
    let result: "Winner" | "Killed" | null;
    let normalizedFrom: string | null = null;

    if (rawResult === null || rawResult === "") {
      result = null;
    } else if (typeof rawResult === "string") {
      const hit = RESULT_SYNONYMS[rawResult.trim().toLowerCase()];
      if (!hit) {
        return NextResponse.json(
          {
            error:
              'result must be "Winner" or "Killed" (or null to clear it) — got "' +
              rawResult +
              '". "loser" and similar spellings are accepted and stored as "Killed".',
          },
          { status: 400 }
        );
      }
      result = hit;
      if (rawResult.trim() !== hit) normalizedFrom = rawResult.trim();
    } else {
      return NextResponse.json(
        { error: 'result must be a string ("Winner" / "Killed") or null.' },
        { status: 400 }
      );
    }

    // ---- learning (optional; absent means "leave it alone") ----
    let learning: string | null | undefined;
    if ("learning" in fields) {
      const rawLearning = fields.learning;
      if (rawLearning === null || (typeof rawLearning === "string" && !rawLearning.trim())) {
        learning = null;
      } else if (typeof rawLearning === "string") {
        const trimmed = rawLearning.trim();
        if (trimmed.length > LEARNING_MAX) {
          return NextResponse.json(
            {
              error:
                "learning is " + trimmed.length + " characters — the limit is " +
                LEARNING_MAX + ".",
            },
            { status: 400 }
          );
        }
        learning = trimmed;
      } else {
        return NextResponse.json(
          { error: "learning must be a string, or null to clear it." },
          { status: 400 }
        );
      }
    }

    // ---- close (optional) ----
    if ("close" in fields && typeof fields.close !== "boolean") {
      return NextResponse.json({ error: "close must be true or false." }, { status: 400 });
    }
    const close = fields.close === true;

    if (close && result === null) {
      return NextResponse.json(
        { error: "close: true needs a result — an ad can't be closed with no verdict on it." },
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

    // Read the row first: it gives the 404, the previous stage to report back,
    // and whether a learning already exists before we warn about the lack of one.
    const { data: before, error: readErr } = await admin
      .from("ads")
      .select("id, dtc_number, ad_name, stage, result, learning")
      .eq("id", id)
      .maybeSingle<AdRow>();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    if (!before) {
      return NextResponse.json({ error: "No ad with that id." }, { status: 404 });
    }

    // result_source / result_set_at arrive in agent_result_schema.sql. Probe
    // rather than assume — writing a column that doesn't exist fails the whole
    // update, and losing the attribution isn't worth losing the write over.
    const { error: probeErr } = await admin
      .from("ads")
      .select("result_source, result_set_at")
      .limit(1);
    const canWriteAudit = !probeErr;

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { result, updated_at: now };
    if (learning !== undefined) patch.learning = learning;
    if (close) patch.stage = CLOSED_STAGE;
    if (canWriteAudit) {
      patch.result_source = result === null ? null : "agent";
      patch.result_set_at = result === null ? null : now;
    }

    const { data: after, error: writeErr } = await admin
      .from("ads")
      .update(patch)
      .eq("id", id)
      .select("id, dtc_number, ad_name, stage, result, learning")
      .maybeSingle<AdRow>();

    if (writeErr) {
      return NextResponse.json({ error: writeErr.message }, { status: 500 });
    }
    if (!after) {
      return NextResponse.json({ error: "No ad with that id." }, { status: 404 });
    }

    // Things the caller should know that aren't reasons to refuse the write.
    const warnings: string[] = [];
    const finalLearning = learning !== undefined ? learning : before.learning;
    if (close && !finalLearning) {
      warnings.push(
        "Closed with no learning. The Learnings view only lists closed ads that have " +
          "one, so this ad won't appear there — send a `learning` to fix that."
      );
    }
    if (!canWriteAudit) {
      warnings.push(
        "result_source / result_set_at not recorded — run agent_result_schema.sql to " +
          "make agent-set verdicts distinguishable from human ones."
      );
    }

    return NextResponse.json({
      ok: true,
      ad: after,
      normalized: normalizedFrom ? { from: normalizedFrom, to: result } : null,
      stage_changed:
        before.stage === after.stage ? null : { from: before.stage, to: after.stage },
      previous_result: before.result,
      attribution_recorded: canWriteAudit,
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

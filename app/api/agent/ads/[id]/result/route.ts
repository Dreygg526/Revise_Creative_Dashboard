// ============================================================
// AGENT API — rank an ad Winner or Killed, and record what it did.
//
//   POST /api/agent/ads/<ad id>/result
//   Authorization: Bearer <AGENT_API_KEY>
//   { "result": "Winner" }                          tag it, leave it where it is
//   { "result": "Killed", "close": true }           tag it AND close it out
//   { "result": "Winner", "learning": "…" }         tag it and record why
//   { "spend": 412.55, "purchases": 6, "cvr": 1.8 } numbers only, no verdict
//   { "result": null }                              clear the verdict
//
// Axel's OpenClaw watches the ads it launched and knows which ones worked.
// Nothing was writing that back: 0 of 126 ads carry a `result`, which is why
// the Learnings view is empty and the Win rate column was pulled from
// Analytics. This is the endpoint that closes that loop.
//
// This route is the machine equivalent of CloseOutModal and takes the same
// five fields it does — outcome, spend, purchases, CVR, learning. Metrics
// were added 2026-08-26 on Axel's report that he could set Winner/Killed but
// "can't put any metrics": a verdict with no numbers behind it isn't
// auditable, and the close-out gate in gates.ts demands all three, so an
// agent-closed ad was landing in a state a person could not have produced.
//
// SCOPE — this widens the agent key past the single meta_ad_id column, so the
// new bound is worth stating exactly. This route can write `result`,
// `learning`, `spend`, `purchases`, `cvr`, and `stage` — but the ONLY stage
// value it can ever write is "Winner / Killed", the terminal one. Ordinary
// pipeline moves live at POST .../stage, which is forward-only. This route
// cannot retitle an ad, reassign it, edit a brief, or delete anything. A
// hijacked key can mislabel outcomes and mis-state performance (both
// reversible from the modal, and the verdict is stamped
// `result_source = 'agent'` so its writes are findable).
//
// CPA is deliberately not accepted: it is never stored anywhere in this app,
// it is computed as spend / purchases by calcCpa(). Sending it is a 400.
//
// It deliberately does NOT enforce the Testing -> Winner/Killed gate from
// gates.ts. That gate exists to stop a person clicking past the close-out
// form; a machine posting a verdict it measured on Meta is a different act.
// Closing with nothing behind it is reported back as a warning rather than
// refused — see the warnings block at the bottom.
// ============================================================

import { NextResponse } from "next/server";
import { requireAgentKey, serviceClient } from "@/app/lib/apiAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The one and only stage this route can write. Keeping it a constant rather
// than a body parameter is what keeps "closing is the only stage move this
// endpoint can make" true.
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

// Every key this route acts on. Anything else in the body is a typo the
// caller wants to hear about — silently ignoring `conversions` or `roas`
// would have OpenClaw reporting success while writing nothing.
const KNOWN_KEYS = ["result", "learning", "spend", "purchases", "cvr", "close"];

// Written fields, in the order they read on the close-out form.
const WRITE_KEYS = ["result", "spend", "purchases", "cvr", "learning"] as const;

interface AdRow {
  id: string;
  dtc_number: number | null;
  ad_name: string | null;
  stage: string;
  result: string | null;
  learning: string | null;
  spend: number | null;
  purchases: number | null;
  cvr: number | null;
}

const ROW_FIELDS =
  "id, dtc_number, ad_name, stage, result, learning, spend, purchases, cvr";

interface NumSpec {
  label: string;
  max?: number;
  integer?: boolean;
  hint?: string;
}

// Parse one optional numeric field. Returns `undefined` when the key is
// absent (leave the column alone), `null` when explicitly cleared, a number
// otherwise — or a NextResponse to return as-is on a bad value.
function parseNumber(
  fields: Record<string, unknown>,
  key: string,
  spec: NumSpec
): number | null | undefined | NextResponse {
  if (!(key in fields)) return undefined;

  const raw = fields[key];
  if (raw === null || raw === "") return null;

  // Strings are accepted because plenty of HTTP tooling stringifies numbers,
  // and refusing "412.55" would be a pointless failure. "" is handled above
  // as a clear; Number("") is 0, which is why that check comes first.
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;

  if (typeof n !== "number" || !Number.isFinite(n)) {
    return NextResponse.json(
      {
        error:
          spec.label + " must be a number, or null to clear it — got " +
          JSON.stringify(raw) + ".",
      },
      { status: 400 }
    );
  }
  if (n < 0) {
    return NextResponse.json(
      { error: spec.label + " can't be negative — got " + n + "." },
      { status: 400 }
    );
  }
  if (spec.integer && !Number.isInteger(n)) {
    return NextResponse.json(
      { error: spec.label + " must be a whole number — got " + n + "." },
      { status: 400 }
    );
  }
  if (spec.max != null && n > spec.max) {
    return NextResponse.json(
      {
        error:
          spec.label + " is " + n + ", above the maximum of " + spec.max + "." +
          (spec.hint ? " " + spec.hint : ""),
      },
      { status: 400 }
    );
  }
  return n;
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

    // Reject unknown keys rather than ignoring them. `cpa` gets its own note
    // because it's the obvious thing to send and is never stored.
    const unknown = Object.keys(fields).filter((k) => !KNOWN_KEYS.includes(k));
    if (unknown.length) {
      const cpaNote = unknown.includes("cpa")
        ? " CPA is never stored — it's computed from spend / purchases."
        : "";
      return NextResponse.json(
        {
          error:
            "Unrecognized field(s): " + unknown.join(", ") + ". Accepted: " +
            KNOWN_KEYS.join(", ") + "." + cpaNote,
        },
        { status: 400 }
      );
    }

    if (!WRITE_KEYS.some((k) => k in fields)) {
      return NextResponse.json(
        {
          error:
            "Nothing to write. Send at least one of: " + WRITE_KEYS.join(", ") + ".",
        },
        { status: 400 }
      );
    }

    // ---- result (optional; absent means "leave it alone") ----
    let result: "Winner" | "Killed" | null | undefined;
    let normalizedFrom: string | null = null;

    if ("result" in fields) {
      const rawResult = fields.result;
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

    // ---- spend / purchases / cvr (all optional) ----
    // These are the manual close-out columns, NOT the meta_* ones. The sync
    // owns meta_spend / meta_purchases / meta_cvr and effectivePerf() prefers
    // them, so a number written here shows on screen only where Meta has
    // nothing — exactly the precedence a human close-out gets.
    const spend = parseNumber(fields, "spend", { label: "spend" });
    if (spend instanceof NextResponse) return spend;

    const purchases = parseNumber(fields, "purchases", {
      label: "purchases",
      integer: true,
    });
    if (purchases instanceof NextResponse) return purchases;

    // CVR is stored as a percentage, not a fraction — AnalyticsView renders it
    // with a literal "%" and computes it as purchases / clicks * 100. A caller
    // sending 0.018 for 1.8% would be off by 100x and nothing downstream would
    // notice, so the ceiling is 100 and the message names the unit.
    const cvr = parseNumber(fields, "cvr", {
      label: "cvr",
      max: 100,
      hint: "CVR is a percentage (1.8 means 1.8%), not a fraction.",
    });
    if (cvr instanceof NextResponse) return cvr;

    // ---- close (optional) ----
    if ("close" in fields && typeof fields.close !== "boolean") {
      return NextResponse.json({ error: "close must be true or false." }, { status: 400 });
    }
    const close = fields.close === true;

    const admin = serviceClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Server is missing Supabase credentials." },
        { status: 500 }
      );
    }

    // Read the row first: it gives the 404, the previous stage to report back,
    // and the existing values to reason about before we warn about gaps.
    const { data: before, error: readErr } = await admin
      .from("ads")
      .select(ROW_FIELDS)
      .eq("id", id)
      .maybeSingle<AdRow>();

    if (readErr) {
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    if (!before) {
      return NextResponse.json({ error: "No ad with that id." }, { status: 404 });
    }

    // An ad can't be closed with no verdict on it — but the verdict may
    // already be on the row from an earlier call, so this is checked against
    // the resulting state rather than the body alone.
    const finalResult = result !== undefined ? result : before.result;
    if (close && !finalResult) {
      return NextResponse.json(
        {
          error:
            "close: true needs a result — this ad has no verdict on it and the " +
            "request didn't set one.",
        },
        { status: 400 }
      );
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
    const patch: Record<string, unknown> = { updated_at: now };
    if (result !== undefined) patch.result = result;
    if (learning !== undefined) patch.learning = learning;
    if (spend !== undefined) patch.spend = spend;
    if (purchases !== undefined) patch.purchases = purchases;
    if (cvr !== undefined) patch.cvr = cvr;
    if (close) patch.stage = CLOSED_STAGE;
    // Only stamp when the verdict itself moved. A metrics-only call leaves
    // attribution alone rather than re-dating someone else's verdict.
    if (canWriteAudit && result !== undefined) {
      patch.result_source = result === null ? null : "agent";
      patch.result_set_at = result === null ? null : now;
    }

    const { data: after, error: writeErr } = await admin
      .from("ads")
      .update(patch)
      .eq("id", id)
      .select(ROW_FIELDS)
      .maybeSingle<AdRow>();

    if (writeErr) {
      return NextResponse.json({ error: writeErr.message }, { status: 500 });
    }
    if (!after) {
      return NextResponse.json({ error: "No ad with that id." }, { status: 404 });
    }

    // Things the caller should know that aren't reasons to refuse the write.
    const warnings: string[] = [];
    if (close && !after.learning) {
      warnings.push(
        "Closed with no learning. The Learnings view only lists closed ads that have " +
          "one, so this ad won't appear there — send a `learning` to fix that."
      );
    }
    if (close) {
      // The Testing -> Winner/Killed gate isn't enforced here (see the header),
      // but a closed ad missing what the gate asks for is one a person could
      // not have produced, so name the numbers that are absent.
      const bare = (["spend", "purchases", "cvr"] as const).filter((k) => after[k] == null);
      if (bare.length) {
        warnings.push(
          "Closed without " + bare.join(" / ") + ". Reports and the close-out gate " +
            "expect all three; Analytics falls back to the Meta sync's numbers " +
            "where it has them."
        );
      }
    }
    if (!canWriteAudit) {
      warnings.push(
        "result_source / result_set_at not recorded — run agent_result_schema.sql to " +
          "make agent-set verdicts distinguishable from human ones."
      );
    }

    // CPA is echoed because it's the number the caller actually wants to see
    // and the one field it must never send. Computed, never stored.
    const cpa =
      after.spend != null && after.purchases != null && after.purchases > 0
        ? after.spend / after.purchases
        : null;

    return NextResponse.json({
      ok: true,
      ad: { ...after, cpa },
      written: WRITE_KEYS.filter((k) => k in fields),
      normalized: normalizedFrom ? { from: normalizedFrom, to: result } : null,
      stage_changed:
        before.stage === after.stage ? null : { from: before.stage, to: after.stage },
      previous_result: before.result,
      attribution_recorded: canWriteAudit && result !== undefined,
      ...(warnings.length ? { warnings } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

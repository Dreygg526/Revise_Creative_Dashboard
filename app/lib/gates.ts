// ============================================================
// PIPELINE GATES
// Defines what must be filled before an ad can move FORWARD
// from one stage to the next. Backward moves are always free.
//
// To change a gate later, edit STAGE_ORDER or the rules below —
// this is the single source of truth for the "hard block" logic.
// ============================================================

import type { Ad } from "@/app/types";

// The boss's 7 stages, in forward order.
export const STAGE_ORDER = [
  "Idea",
  "Brief",
  "In Production",
  "Review",
  "Ready to Launch",
  "Testing",
  "Winner / Killed",
] as const;

export type Stage = (typeof STAGE_ORDER)[number];

// A gate rule checks an ad and returns a list of missing-field
// labels. Empty list = nothing missing = move allowed.
type GateRule = (ad: Ad) => string[];

// Rules are keyed by the stage you are LEAVING (moving forward from).
// e.g. GATES["Idea"] runs when moving Idea -> Brief.
const GATES: Partial<Record<Stage, GateRule>> = {
  // Idea -> Brief : Zone 1 strategy must be complete.
  Idea: (ad) => {
    const missing: string[] = [];
    if (!ad.persona) missing.push("Persona");
    if (!ad.core_emotion) missing.push("Core Emotion");
    if (!ad.problem) missing.push("Problem");
    if (!ad.awareness) missing.push("Awareness");
    return missing;
  },

  // Brief -> In Production : brief link + editor assigned.
  Brief: (ad) => {
    const missing: string[] = [];
    if (!ad.brief_link) missing.push("Brief link");
    if (!ad.assigned_editor) missing.push("Editor");
    return missing;
  },

  // Ready to Launch -> Testing : at least one destination URL set.
  "Ready to Launch": (ad) => {
    const missing: string[] = [];
    const urls = (ad.destination_urls ?? []).filter((u) => u && u.trim());
    if (urls.length === 0) missing.push("Destination URL");
    return missing;
  },

  // Testing -> Winner / Killed : performance + learning required.
  Testing: (ad) => {
    const missing: string[] = [];
    if (!ad.result) missing.push("Result (Winner/Killed)");
    if (ad.spend == null) missing.push("Spend");
    if (ad.purchases == null) missing.push("Purchases");
    if (ad.cvr == null) missing.push("CVR");
    if (!ad.learning) missing.push("Learning");
    return missing;
  },

  // In Production -> Review : no extra requirement.
  // Review -> Ready to Launch : no extra requirement.
};

// Index helpers.
export function stageIndex(stage: string): number {
  return STAGE_ORDER.indexOf(stage as Stage);
}

export function isForward(from: string, to: string): boolean {
  return stageIndex(to) > stageIndex(from);
}

// Main check: can this ad move from `from` to `to`?
// Returns { allowed, missing } where `missing` lists what to fill.
export function checkMove(
  ad: Ad,
  from: string,
  to: string
): { allowed: boolean; missing: string[] } {
  // Backward or same-stage moves are always free.
  if (!isForward(from, to)) {
    return { allowed: true, missing: [] };
  }

  // Forward moves must pass EVERY gate between from and to.
  // (Usually one step, but this handles skipping ahead too.)
  const fromIdx = stageIndex(from);
  const toIdx = stageIndex(to);
  let allMissing: string[] = [];

  for (let i = fromIdx; i < toIdx; i++) {
    const leavingStage = STAGE_ORDER[i];
    const rule = GATES[leavingStage];
    if (rule) {
      allMissing = allMissing.concat(rule(ad));
    }
  }

  return { allowed: allMissing.length === 0, missing: allMissing };
}
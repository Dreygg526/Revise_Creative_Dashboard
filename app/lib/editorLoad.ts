// ============================================================
// EDITOR LOAD
// How many ads each editor is actually working on right now, so the
// person assigning an ad can see who is full and who is free.
//
// Only the stages where an editor has work to do count. Ready to Launch
// and Testing are finished from the editor's side, and there are dozens
// of ads parked there — counting them would bury the real signal.
// ============================================================

import type { Ad } from "@/app/types";

export const EDITOR_WORK_STAGES = ["Brief", "In Production", "Review"] as const;

// Same thresholds the Workload view colours its bars with.
export const AMBER_AT = 4; // 4-5 = getting full
export const RED_AT = 6;   // 6+  = overloaded

export function loadColor(n: number): string {
  if (n >= RED_AT) return "#ef4444";  // red — overloaded
  if (n >= AMBER_AT) return "#eab308"; // amber — getting full
  return "#22c55e";                    // green — healthy
}

export interface EditorLoad {
  total: number;
  byStage: { stage: string; count: number }[];
}

export function editorLoads(ads: Ad[]): Map<string, EditorLoad> {
  const counts = new Map<string, Record<string, number>>();
  for (const a of ads) {
    if (!a.assigned_editor) continue;
    if (!(EDITOR_WORK_STAGES as readonly string[]).includes(a.stage)) continue;
    const c = counts.get(a.assigned_editor) ?? {};
    c[a.stage] = (c[a.stage] ?? 0) + 1;
    counts.set(a.assigned_editor, c);
  }
  const out = new Map<string, EditorLoad>();
  for (const [name, c] of counts) {
    const byStage = EDITOR_WORK_STAGES
      .map((stage) => ({ stage, count: c[stage] ?? 0 }))
      .filter((s) => s.count > 0);
    out.set(name, { total: byStage.reduce((n, s) => n + s.count, 0), byStage });
  }
  return out;
}

export function loadFor(loads: Map<string, EditorLoad>, name: string): EditorLoad {
  return loads.get(name) ?? { total: 0, byStage: [] };
}

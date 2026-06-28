// ============================================================
// REVISE CREATIVE DASHBOARD — TYPES
// Mirrors the Supabase schema (phase1_schema.sql) one-to-one.
// Location: app/types/index.ts
// ============================================================


// ------------------------------------------------------------
// AD — the heart. One row per ad in the `ads` table.
// Grouped by the boss's three zones.
// ------------------------------------------------------------
export interface Ad {
  id: string;

  // ---- Basics / identity ----
  dtc_number: number | null;
  ad_name: string | null;
  product: string | null;

  // ---- Pipeline ----
  stage: string;                 // one of the 7 placeholder stages (editable list)
  result: string | null;         // 'Winner' | 'Killed' | null (only set at close)
  priority: string | null;       // 'Low' | 'Medium' | 'High' (editable list)

  // ---- ZONE 1: STRATEGY (gate: filled before brief starts) ----
  persona: string | null;
  sub_avatar: string | null;
  core_emotion: string | null;
  problem: string | null;
  awareness: string | null;
  angle: string | null;
  concept: string | null;

  // ---- ZONE 2: OPERATIONAL ----
  assigned_strategist: string | null;
  assigned_editor: string | null;
  assigned_media_buyer: string | null;
  assigned_designer: string | null;
  format: string | null;         // 'Video Ad' | 'Static' | ...
  ad_type: string | null;        // Imitation | Ideation | Iteration | New Concept
  content_source: string | null;
  due_date: string | null;       // ISO date
  brief_link: string | null;
  frame_io_link: string | null;
  destination_url: string | null;            // legacy single (kept, unused going forward)
  destination_urls: string[];                // multiple entries
  whitelisting_pages: string[];              // multiple entries
  notes: string | null;
  revision_count: number;

  // ---- END-OF-LIFE: PERFORMANCE + LEARNING ----
  // (nullable; app enforces "must fill to mark Winner/Killed")
  // NOTE: cpa is NOT here — it's auto-calculated in the app (spend / purchases)
  spend: number | null;
  purchases: number | null;
  cvr: number | null;
  learning: string | null;       // required one-line learning at close

  // ---- Audit ----
  created_by: string | null;
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
}


// ------------------------------------------------------------
// SETTINGS LIST — every editable dropdown value.
// list_type groups them: 'stage' | 'persona' | 'core_emotion'
//   | 'problem' | 'awareness' | 'format' | 'role'
// ------------------------------------------------------------
export type SettingsListType =
  | 'stage'
  | 'persona'
  | 'sub_avatar'
  | 'core_emotion'
  | 'problem'
  | 'awareness'
  | 'angle'
  | 'concept'
  | 'format'
  | 'ad_type'
  | 'content_source'
  | 'product'
  | 'priority'
  | 'role';

export interface SettingsList {
  id: string;
  list_type: SettingsListType;
  value: string;
  sort_order: number;
  created_at: string;
}

// Single-value targets used for color-coding (Analytics/Reports).
export interface SettingsTarget {
  id: string;
  key: string;          // 'target_cpa' | 'target_hit_rate'
  value: number | null;
  updated_at: string;
}


// ------------------------------------------------------------
// TEAM MEMBER — the crew + roles.
// ------------------------------------------------------------
export type Role =
  | 'Founder'
  | 'Strategist'
  | 'Editor'
  | 'Media Buyer'
  | 'Graphic Designer';

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  email: string | null;
  status: string;           // 'active' | 'invited'
  created_at: string;
}


// ------------------------------------------------------------
// SCRIPT — carried over from old project.
// ------------------------------------------------------------
export type ScriptStatus = 'Draft' | 'In Review' | 'Approved';

export interface Script {
  id: string;
  ad_id: string;
  title: string | null;
  body: string | null;
  messaging_intent: string | null;
  status: ScriptStatus;
  is_primary: boolean;
  generated_by_ai: boolean;
  ai_model: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}


// ------------------------------------------------------------
// SCRIPT SCENE — carried over from old project.
// ------------------------------------------------------------
export interface ScriptScene {
  id: string;
  script_id: string;
  scene_order: number;
  scene_text: string | null;
  visual_direction: string | null;
  duration_seconds: number | null;
  is_done: boolean;
  created_at: string;
}


// ------------------------------------------------------------
// DERIVED HELPERS (not tables — computed in the app)
// ------------------------------------------------------------

// A "Learning" is just a closed Ad that has a learning written.
// The Learnings page filters ads where result + learning exist.
// This alias documents that intent; no separate table.
export type Learning = Ad;

// CPA is computed, never stored.
export function calcCpa(ad: Pick<Ad, 'spend' | 'purchases'>): number | null {
  if (ad.spend == null || ad.purchases == null || ad.purchases === 0) {
    return null;
  }
  return ad.spend / ad.purchases;
}
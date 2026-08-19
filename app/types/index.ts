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
  // Who set `result` (agent_result_schema.sql). 'agent' = written through
  // /api/agent/ads/{id}/result; null = set by a person in the close-out modal,
  // which doesn't write this column. Lets an agent's verdicts be found and
  // undone as a group if its ranking turns out to be wrong.
  result_source: string | null;
  result_set_at: string | null;  // ISO timestamp; unlike updated_at, only moves when the verdict does
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
  revision_note: string | null;
  script_hook: string | null;

  // ---- END-OF-LIFE: PERFORMANCE + LEARNING ----
  // (nullable; app enforces "must fill to mark Winner/Killed")
  // NOTE: cpa is NOT here — it's auto-calculated in the app (spend / purchases)
  spend: number | null;
  purchases: number | null;
  cvr: number | null;
  learning: string | null;
  selected_headline: string | null;
  selected_ad_copy: string | null;

  // ---- META ADS SYNC (auto-pulled; never overwrites the manual fields above) ----
  // meta_ad_id is the manual escape hatch: paste a Meta ad ID to force the
  // link when name matching can't resolve the ad on its own.
  meta_ad_id: string | null;
  meta_spend: number | null;
  meta_purchases: number | null;
  meta_revenue: number | null;
  meta_cvr: number | null;
  meta_impressions: number | null;
  meta_clicks: number | null;
  meta_matched_name: string | null;
  meta_matched_count: number | null;
  meta_ad_ids: string[] | null;
  // The individual Meta ads that summed into the totals above (schema v5).
  // Null until v5 is run and a sync has run. Read-only — written by
  // /api/meta-sync, never by the modal's persist().
  meta_breakdown: MetaBreakdownRow[] | null;
  // Creative thumbnail (schema v4). Triple Whale's CDN copy, so it doesn't
  // expire with an access token. Null until v4 is run and a sync has run.
  meta_ad_image_url: string | null;
  meta_match_method: MetaMatchMethod | null;
  meta_synced_at: string | null;   // ISO timestamp

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
  | 'Graphic Designer'
  | 'Media Buyer';

export interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  status: string;          // 'active' | 'invited'
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


// ------------------------------------------------------------
// META SYNC HELPERS
// ------------------------------------------------------------

// How a dashboard ad got linked to its Meta ad(s).
//  'override'     — someone pasted a Meta ad ID onto the ad by hand
//  'dtc_number'   — DTC number parsed out of the Meta AD name
//  'dtc_adset'    — DTC number parsed out of the Meta AD SET name
//  'dtc_campaign' — DTC number parsed out of the Meta CAMPAIGN name
//  'ad_name'      — fell back to matching ad_name text
//
// In this account the ad set carries the DTC number ("DTC #82 || Static Ad
// || ...") and the ad name is the creative variant ("VARIATION 3 II PDP"),
// so 'dtc_adset' is the common case.
export type MetaMatchMethod =
  | 'override'
  | 'dtc_number'
  | 'dtc_adset'
  | 'dtc_campaign'
  | 'ad_name';

// One Meta ad that fed a brief's rolled-up meta_* totals (schema v5).
// Stored as JSON on ads.meta_breakdown, highest spend first.
//
// `variant` is the FULL DTC token including any decimal — "21" vs "21.1".
// The matcher deliberately collapses decimals into their integer parent, so
// #21, #21.1 and #21.2 all land on dashboard DTC 21. Keeping the un-collapsed
// token here is what lets the UI show how much of a brief's spend is actually
// its iterations, which is the evidence needed to decide whether collapsing
// them is right. Null when the names carried no parseable DTC number (an
// override or ad_name match).
export interface MetaBreakdownRow {
  ad_id: string;
  ad_name: string;
  adset_name: string | null;
  // The Meta ad account this ad lives in ("act_…"). Null on rows written
  // before the multi-account fix, or from a provider that didn't report it.
  account_id: string | null;
  variant: string | null;
  spend: number;
  purchases: number;
  revenue: number;
  impressions: number;
  clicks: number;
}

// Where a displayed performance number came from.
export type PerfSource = 'meta' | 'manual' | 'none';

// Meta wins when it has data; manual close-out numbers are the fallback.
// Nothing here mutates the ad — this is purely a read-time preference.
export function effectivePerf(ad: Ad): {
  spend: number | null;
  purchases: number | null;
  revenue: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  aov: number | null;
  source: PerfSource;
} {
  const hasMeta = ad.meta_spend != null || ad.meta_purchases != null;
  const spend = hasMeta ? ad.meta_spend : ad.spend;
  const purchases = hasMeta ? ad.meta_purchases : ad.purchases;
  const cvr = hasMeta ? ad.meta_cvr : ad.cvr;
  // Revenue only ever comes from Meta — there's no manual field for it.
  const revenue = ad.meta_revenue;

  const source: PerfSource = hasMeta
    ? 'meta'
    : ad.spend != null || ad.purchases != null
      ? 'manual'
      : 'none';

  return {
    spend,
    purchases,
    revenue,
    cvr,
    cpa: calcCpa({ spend, purchases }),
    // ROAS and AOV are derived, never stored — same rule as CPA.
    roas: revenue != null && spend != null && spend > 0 ? revenue / spend : null,
    aov: revenue != null && purchases != null && purchases > 0 ? revenue / purchases : null,
    source,
  };
}
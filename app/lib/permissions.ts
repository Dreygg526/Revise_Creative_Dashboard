// ============================================================
// PERMISSIONS — single source of truth for who can do what.
// Roles: Founder, Strategist, Editor, Graphic Designer, Media Buyer.
// Graphic Designer has the SAME permissions as Editor.
// ============================================================

export type Action =
  | "create_ad"
  | "edit_zone1"        // strategy fields
  | "edit_title"
  | "edit_zone2"        // operational fields
  | "move_stage"
  | "edit_performance"  // spend/purchases/cvr + close (Winner/Killed)
  | "delete_ad"
  | "batch_delete"
  | "manage_team"       // invite, change roles, remove members
  | "manage_lists";     // Settings dropdown lists

// Normalize: Graphic Designer is treated as Editor.
function normalize(role: string | null): string {
  if (role === "Graphic Designer") return "Editor";
  return role ?? "";
}

// The rule table. Each action lists the roles allowed.
const RULES: Record<Action, string[]> = {
  create_ad:        ["Founder", "Strategist"],
  edit_zone1:       ["Founder", "Strategist"],
  edit_title:       ["Founder", "Strategist"],
  edit_zone2:       ["Founder", "Strategist", "Media Buyer"],
  move_stage:       ["Founder", "Strategist", "Editor", "Media Buyer"],
  edit_performance: ["Founder", "Strategist", "Media Buyer"],
  delete_ad:        ["Founder", "Strategist"],
  batch_delete:     ["Founder", "Strategist"],
  manage_team:      ["Founder"],            // Founder only
  manage_lists:     ["Founder", "Strategist"],
};

// The core check: can this role perform this action?
export function can(role: string | null, action: Action): boolean {
  const r = normalize(role);
  if (!r) return false;
  return RULES[action]?.includes(r) ?? false;
}
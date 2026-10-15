// Server-only: the edits "Ask the dashboard" is allowed to make, and the one
// validator both the chat and the Approve button go through.
//
// The rule is "exactly what this person could do in the ad card, nothing
// more": the same permission per field (permissions.ts), the same dropdown
// values (settings_lists), the same stage gates (gates.ts). Deleting is not
// offered at all. Everything is validated twice — when Claude proposes it and
// again when it's applied — so a proposal edited in transit, or a card someone
// changed in the meantime, can't slip through.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ad, SettingsListType } from "@/app/types";
import { can, type Action } from "@/app/lib/permissions";
import { checkMove, isForward, isSelfProduced, STAGE_ORDER } from "@/app/lib/gates";

type Kind = "list" | "person" | "text" | "url" | "date" | "result" | "money" | "int" | "pct" | "stage";

interface FieldSpec {
  label: string;
  action: Action;
  kind: Kind;
  list?: SettingsListType;
  nullable: boolean;
}

// Mirrors the ad card's zones. `concept` isn't on the card yet but is a
// strategy tag with its own Settings list, and it's 100% empty — tagging it in
// bulk is one of the main reasons to edit from chat.
export const EDITABLE_FIELDS: Record<string, FieldSpec> = {
  ad_name:             { label: "Name",          action: "edit_title",       kind: "text",   nullable: false },
  persona:             { label: "Persona",       action: "edit_zone1",       kind: "list",   list: "persona",      nullable: true },
  core_emotion:        { label: "Core emotion",  action: "edit_zone1",       kind: "list",   list: "core_emotion", nullable: true },
  problem:             { label: "Problem",       action: "edit_zone1",       kind: "list",   list: "problem",      nullable: true },
  awareness:           { label: "Awareness",     action: "edit_zone1",       kind: "list",   list: "awareness",    nullable: true },
  angle:               { label: "Angle",         action: "edit_zone1",       kind: "list",   list: "angle",        nullable: true },
  concept:             { label: "Concept",       action: "edit_zone1",       kind: "list",   list: "concept",      nullable: true },
  // What the Copy Agent's "Send to Ad" writes; also set from Claude Code (save_copy).
  selected_headline:   { label: "Selected headline", action: "edit_zone1",   kind: "text",   nullable: true },
  selected_ad_copy:    { label: "Selected ad copy",  action: "edit_zone1",   kind: "text",   nullable: true },
  assigned_strategist: { label: "Strategist",    action: "edit_zone2",       kind: "person", nullable: true },
  assigned_editor:     { label: "Editor",        action: "edit_zone2",       kind: "person", nullable: true },
  assigned_media_buyer:{ label: "Media buyer",   action: "edit_zone2",       kind: "person", nullable: true },
  product:             { label: "Product",       action: "edit_zone2",       kind: "list",   list: "product",      nullable: true },
  format:              { label: "Format",        action: "edit_zone2",       kind: "list",   list: "format",       nullable: true },
  ad_type:             { label: "Ad type",       action: "edit_zone2",       kind: "list",   list: "ad_type",      nullable: true },
  priority:            { label: "Priority",      action: "edit_zone2",       kind: "list",   list: "priority",     nullable: true },
  due_date:            { label: "Due date",      action: "edit_zone2",       kind: "date",   nullable: true },
  brief_link:          { label: "Brief link",    action: "edit_zone2",       kind: "url",    nullable: true },
  frame_io_link:       { label: "Frame.io link", action: "edit_zone2",       kind: "url",    nullable: true },
  notes:               { label: "Notes",         action: "edit_zone2",       kind: "text",   nullable: true },
  result:              { label: "Result",        action: "edit_performance", kind: "result", nullable: true },
  learning:            { label: "Learning",      action: "edit_performance", kind: "text",   nullable: true },
  spend:               { label: "Spend (close-out)",     action: "edit_performance", kind: "money", nullable: true },
  purchases:           { label: "Purchases (close-out)", action: "edit_performance", kind: "int",   nullable: true },
  cvr:                 { label: "CVR % (close-out)",     action: "edit_performance", kind: "pct",   nullable: true },
  stage:               { label: "Stage",         action: "move_stage",       kind: "stage",  nullable: false },
};

export type FieldValue = string | number | null;

// What Claude sends (by DTC number) or the browser sends back (by id, with
// the value it saw, so a card changed in the meantime is caught).
export interface ChangeRequest {
  dtc_number?: number;
  ad_id?: string;
  field: string;
  value: FieldValue;
  expected?: FieldValue;
}

export interface ChangeItem {
  ad_id: string;
  dtc: number | null;
  name: string;
  field: string;
  label: string;
  from: FieldValue;
  to: FieldValue;
}

export interface EditUser {
  role: string | null;
  name: string | null;
}

interface Lookups {
  lists: Map<string, string[]>;
  people: string[];
}

async function loadLookups(admin: SupabaseClient): Promise<Lookups> {
  const [{ data: lists }, { data: team }] = await Promise.all([
    admin.from("settings_lists").select("list_type, value, sort_order").order("sort_order"),
    admin.from("team_members").select("name"),
  ]);
  const map = new Map<string, string[]>();
  for (const r of lists ?? []) {
    if (!map.has(r.list_type)) map.set(r.list_type, []);
    map.get(r.list_type)!.push(r.value);
  }
  return { lists: map, people: (team ?? []).map((t) => t.name).filter(Boolean) };
}

const same = (a: FieldValue | undefined, b: FieldValue | undefined) =>
  (a == null || a === "" ? null : String(a)) === (b == null || b === "" ? null : String(b));

// Coerce + check one value against its field. Returns the stored value or an error.
function coerce(spec: FieldSpec, raw: FieldValue, lk: Lookups): { value: FieldValue } | { error: string } {
  if (raw == null || raw === "") {
    return spec.nullable ? { value: null } : { error: `${spec.label} can't be empty.` };
  }
  const s = String(raw).trim();
  switch (spec.kind) {
    case "list": {
      const options = lk.lists.get(spec.list!) ?? [];
      if (!options.length) return { value: s }; // no list managed for this field — free text, like the card
      const hit = options.find((o) => o.toLowerCase() === s.toLowerCase());
      return hit
        ? { value: hit }
        : { error: `“${s}” isn't a ${spec.label.toLowerCase()} in Settings. Options: ${options.slice(0, 25).join(" · ")}${options.length > 25 ? " …" : ""}` };
    }
    case "person": {
      const hit = lk.people.find((p) => p.toLowerCase() === s.toLowerCase());
      return hit ? { value: hit } : { error: `“${s}” isn't on the team. Team: ${lk.people.join(", ")}` };
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? { value: s } : { error: `${spec.label} must be YYYY-MM-DD.` };
    case "url":
      return /^https?:\/\/\S+$/i.test(s) ? { value: s } : { error: `${spec.label} must be a full link starting with http.` };
    case "result": {
      const v = s.toLowerCase();
      if (["winner", "win", "w"].includes(v)) return { value: "Winner" };
      if (["killed", "kill", "loser", "looser", "lost", "l"].includes(v)) return { value: "Killed" };
      return { error: "Result must be Winner or Killed." };
    }
    case "money": {
      const n = Number(s.replace(/[$,]/g, ""));
      return Number.isFinite(n) && n >= 0 ? { value: Math.round(n * 100) / 100 } : { error: `${spec.label} must be a number ≥ 0.` };
    }
    case "int": {
      const n = Number(s);
      return Number.isInteger(n) && n >= 0 ? { value: n } : { error: `${spec.label} must be a whole number ≥ 0.` };
    }
    case "pct": {
      const n = Number(s.replace("%", ""));
      return Number.isFinite(n) && n >= 0 && n <= 100 ? { value: n } : { error: `${spec.label} is a percentage, 0–100 (1.8 means 1.8%).` };
    }
    case "stage":
      return (STAGE_ORDER as readonly string[]).includes(s) ? { value: s } : { error: `Stage must be one of: ${STAGE_ORDER.join(" · ")}.` };
    default:
      return { value: s };
  }
}

export interface ValidationResult {
  items: ChangeItem[];
  errors: string[];
}

// Validate a batch against the live rows. Nothing is written here.
export async function validateChanges(
  admin: SupabaseClient,
  user: EditUser,
  requests: ChangeRequest[],
  checkExpected = false
): Promise<ValidationResult> {
  const errors: string[] = [];
  if (!requests.length) return { items: [], errors: ["No changes given."] };
  if (requests.length > 100) return { items: [], errors: ["At most 100 changes at once."] };

  const ids = [...new Set(requests.map((r) => r.ad_id).filter((x): x is string => !!x))];
  const dtcs = [...new Set(requests.map((r) => r.dtc_number).filter((x): x is number => x != null))];
  const [lk, byId, byDtc] = await Promise.all([
    loadLookups(admin),
    ids.length ? admin.from("ads").select("*").in("id", ids) : Promise.resolve({ data: [] as Ad[] }),
    dtcs.length ? admin.from("ads").select("*").in("dtc_number", dtcs) : Promise.resolve({ data: [] as Ad[] }),
  ]);
  const rows = new Map<string, Ad>();
  for (const a of [...(byId.data ?? []), ...(byDtc.data ?? [])] as Ad[]) rows.set(a.id, a);

  // Resolve each request to a row, then fold per ad so stage gates see the
  // card as it will be after every other change in the batch.
  const perAd = new Map<string, { ad: Ad; changes: { field: string; spec: FieldSpec; value: FieldValue }[] }>();
  for (const r of requests) {
    const spec = EDITABLE_FIELDS[r.field];
    if (!spec) {
      errors.push(`“${r.field}” can't be edited from chat. Editable: ${Object.keys(EDITABLE_FIELDS).join(", ")}.`);
      continue;
    }
    let ad: Ad | undefined;
    if (r.ad_id) ad = rows.get(r.ad_id);
    else if (r.dtc_number != null) {
      const hits = [...rows.values()].filter((a) => a.dtc_number === r.dtc_number);
      if (hits.length > 1) {
        errors.push(`Two cards share DTC #${r.dtc_number} — edit that one in the dashboard so the right card changes.`);
        continue;
      }
      ad = hits[0];
    }
    if (!ad) {
      errors.push(r.dtc_number != null ? `No card with DTC #${r.dtc_number}.` : "That card no longer exists.");
      continue;
    }
    if (!can(user.role, spec.action)) {
      errors.push(`You (${user.role ?? "no role"}) can't change ${spec.label.toLowerCase()} — same rule as in the ad card.`);
      continue;
    }
    const c = coerce(spec, r.value, lk);
    if ("error" in c) {
      errors.push(`DTC #${ad.dtc_number}: ${c.error}`);
      continue;
    }
    const current = (ad as unknown as Record<string, FieldValue>)[r.field] ?? null;
    if (checkExpected && "expected" in r && !same(current, r.expected)) {
      errors.push(`DTC #${ad.dtc_number} ${spec.label.toLowerCase()} changed since this was proposed (now “${current ?? "empty"}”). Ask again.`);
      continue;
    }
    if (same(current, c.value)) continue; // already that value — nothing to do
    if (!perAd.has(ad.id)) perAd.set(ad.id, { ad, changes: [] });
    perAd.get(ad.id)!.changes.push({ field: r.field, spec, value: c.value });
  }

  const items: ChangeItem[] = [];
  for (const { ad, changes } of perAd.values()) {
    const after = { ...ad } as unknown as Record<string, FieldValue>;
    for (const ch of changes) after[ch.field] = ch.value;
    const next = after as unknown as Ad;

    // Making strategist == editor is how "self-produced" is stored; the card
    // gates that checkbox on self_produce, so the chat does too.
    if (!isSelfProduced(ad) && isSelfProduced(next) && !can(user.role, "self_produce")) {
      errors.push(`DTC #${ad.dtc_number}: setting the editor to the strategist marks it self-produced, which only Founders and Strategists can do.`);
      continue;
    }

    const stageChange = changes.find((c) => c.field === "stage");
    if (stageChange) {
      const from = ad.stage, to = String(stageChange.value);
      if (from === "Ready to Launch" && to === "Testing") {
        errors.push(`DTC #${ad.dtc_number}: moving into Testing goes through the pre-launch checklist — do it from the ad card.`);
        continue;
      }
      if (to === "Winner / Killed" && !can(user.role, "edit_performance")) {
        errors.push(`DTC #${ad.dtc_number}: closing out needs Founder, Strategist or Media Buyer.`);
        continue;
      }
      if (isForward(from, to)) {
        const { allowed, missing } = checkMove(next, from, to);
        if (!allowed) {
          errors.push(`DTC #${ad.dtc_number} can't move ${from} → ${to} yet. Missing: ${missing.join(", ")}.`);
          continue;
        }
      }
    }

    for (const ch of changes) {
      items.push({
        ad_id: ad.id,
        dtc: ad.dtc_number,
        name: ad.ad_name || "(untitled)",
        field: ch.field,
        label: ch.spec.label,
        from: (ad as unknown as Record<string, FieldValue>)[ch.field] ?? null,
        to: ch.value,
      });
    }
  }

  return { items, errors };
}

// Validate again (including that nothing moved underneath), then write.
// Validation is all or nothing — one bad change and nothing is written. The
// writes themselves are one update per card, so a database error part-way
// can leave earlier cards written; the caller gets those failures back.
export async function applyChanges(
  admin: SupabaseClient,
  user: EditUser,
  requests: ChangeRequest[]
): Promise<ValidationResult & { applied: boolean }> {
  const fresh = requests.filter((r) => r.ad_id === NEW_CARD);
  if (fresh.length) {
    if (fresh.length !== requests.length) return { items: [], errors: ["Create the new card on its own, then edit others."], applied: false };
    return createCard(admin, user, requests);
  }
  const v = await validateChanges(admin, user, requests, true);
  if (v.errors.length || !v.items.length) return { ...v, applied: false };

  const byAd = new Map<string, Record<string, FieldValue>>();
  for (const it of v.items) {
    if (!byAd.has(it.ad_id)) byAd.set(it.ad_id, {});
    byAd.get(it.ad_id)![it.field] = it.to;
  }
  const now = new Date().toISOString();
  const failures: string[] = [];
  for (const [id, fields] of byAd) {
    const { error } = await admin.from("ads").update({ ...fields, updated_at: now }).eq("id", id);
    if (error) failures.push(error.message);
  }
  return { items: v.items, errors: failures, applied: failures.length === 0 };
}

// ---- New cards -----------------------------------------------------------------
// Creating is offered for one case only: a new card in "Idea", from a brief
// (Nemanja's ask, 2026-10-14), behind the same approval card. Items carry
// ad_id NEW_CARD until written; the DTC number shown is a preview and is taken
// fresh from the database at insert. Needs create_ad, plus each field's own
// edit permission, exactly as filling in a new card by hand.

export const NEW_CARD = "new";
export const NEW_CARD_FIELDS = [
  "ad_name", "product", "persona", "core_emotion", "problem", "awareness", "angle", "concept",
  "format", "ad_type", "priority", "due_date", "brief_link", "notes", "assigned_strategist", "assigned_editor",
] as const;

async function nextDtc(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from("ads").select("dtc_number").not("dtc_number", "is", null).order("dtc_number", { ascending: false }).limit(1);
  return ((data?.[0]?.dtc_number as number | undefined) ?? 0) + 1;
}

export async function validateNewCard(
  admin: SupabaseClient,
  user: EditUser,
  requests: { field: string; value: FieldValue }[]
): Promise<ValidationResult> {
  if (!can(user.role, "create_ad")) return { items: [], errors: [`You (${user.role ?? "no role"}) can't create cards. Founders, Strategists and Editors can.`] };
  const [lk, dtc] = await Promise.all([loadLookups(admin), nextDtc(admin)]);
  const errors: string[] = [];
  const values = new Map<string, FieldValue>();
  for (const r of requests) {
    const spec = EDITABLE_FIELDS[r.field];
    if (!spec || !(NEW_CARD_FIELDS as readonly string[]).includes(r.field)) {
      errors.push(`“${r.field}” can't be set on a new card. Allowed: ${NEW_CARD_FIELDS.join(", ")}.`);
      continue;
    }
    if (!can(user.role, spec.action)) {
      errors.push(`You (${user.role ?? "no role"}) can't set ${spec.label.toLowerCase()}. Left out.`);
      continue;
    }
    const c = coerce(spec, r.value, lk);
    if ("error" in c) errors.push(`New card: ${c.error}`);
    else if (c.value != null) values.set(r.field, c.value);
  }
  const name = values.get("ad_name");
  if (!name) return { items: [], errors: [...errors, "A new card needs a name."] };
  const draft = { assigned_strategist: values.get("assigned_strategist") ?? null, assigned_editor: values.get("assigned_editor") ?? null } as unknown as Ad;
  if (isSelfProduced(draft) && !can(user.role, "self_produce")) {
    values.delete("assigned_editor");
    errors.push("Editor left out: making the strategist the editor marks it self-produced, which only Founders and Strategists can do.");
  }
  const items: ChangeItem[] = [
    { ad_id: NEW_CARD, dtc, name: String(name), field: "stage", label: "Stage", from: null, to: "Idea" },
    ...NEW_CARD_FIELDS.filter((f) => values.has(f)).map((f) => ({
      ad_id: NEW_CARD, dtc, name: String(name), field: f, label: EDITABLE_FIELDS[f].label, from: null, to: values.get(f)!,
    })),
  ];
  return { items, errors };
}

async function createCard(admin: SupabaseClient, user: EditUser, requests: ChangeRequest[]): Promise<ValidationResult & { applied: boolean }> {
  const v = await validateNewCard(admin, user, requests.filter((r) => r.field !== "stage"));
  // All or nothing, like edits: what was approved is exactly what gets written.
  if (!v.items.length || v.errors.length) return { ...v, applied: false };
  const row: Record<string, FieldValue> = { stage: "Idea", created_by: user.name };
  for (const it of v.items) row[it.field] = it.to;
  row.stage = "Idea";
  // Number at insert; one retry if someone took it in the same moment.
  for (let attempt = 0; attempt < 2; attempt++) {
    const dtc = await nextDtc(admin);
    const { data, error } = await admin.from("ads").insert([{ ...row, dtc_number: dtc }]).select("id, dtc_number").single();
    if (!error && data) {
      return { applied: true, errors: [], items: v.items.map((it) => ({ ...it, ad_id: data.id as string, dtc: data.dtc_number as number })) };
    }
    if (attempt === 1 || !/duplicate|unique/i.test(error?.message ?? "")) return { items: v.items, errors: [error?.message ?? "Insert failed."], applied: false };
  }
  return { items: v.items, errors: ["Insert failed."], applied: false };
}

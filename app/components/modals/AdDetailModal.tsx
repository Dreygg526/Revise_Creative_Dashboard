"use client";

import { useState, useEffect, useRef } from "react";
import { X, Lock, ArrowRight, Trash2, Plus } from "lucide-react";
import { useSettings } from "@/app/hooks/useSettings";
import { useMyRole } from "@/app/hooks/useMyRole";
import { can } from "@/app/lib/permissions";
import { STAGE_ORDER, checkMove, stageIndex } from "@/app/lib/gates";
import type { Ad } from "@/app/types";

interface AdDetailModalProps {
  ad: Ad;
  onClose: () => void;
  onSave: (id: string, fields: Partial<Ad>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  backgroundColor: "var(--nested)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text)",
  fontSize: "14px",
  fontFamily: "inherit",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  color: "var(--text-secondary)",
  marginBottom: "6px",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-muted)",
  marginBottom: "12px",
  marginTop: "4px",
};

export default function AdDetailModal({ ad, onClose, onSave, onDelete }: AdDetailModalProps) {
  const { valuesFor, strategistOptions, editorOptions, mediaBuyerOptions } = useSettings();
  const myRole = useMyRole();
  const allowTitle = can(myRole, "edit_title");
  const allowZone1 = can(myRole, "edit_zone1");
  const allowZone2 = can(myRole, "edit_zone2");
  const allowPerf = can(myRole, "edit_performance");
  const allowMove = can(myRole, "move_stage");
  const allowDelete = can(myRole, "delete_ad");

  // Local editable copy of the ad. We save on blur / explicit save.
  const [draft, setDraft] = useState<Ad>(ad);

  // Keep the local draft in sync if the underlying ad reference changes
  // (e.g. after a save refreshes the list).
  useEffect(() => {
    if (ad) setDraft(ad);
  }, [ad]);

  // ----- AUTOSAVE -----
  // Debounced save whenever the draft changes. We skip the initial load
  // and skip while a manual save / stage move is happening.
  const didMount = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Skip the first render (draft just loaded from the ad — nothing to save).
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    // Skip if draft matches the incoming ad (change came from a refresh, not a user edit).
    if (JSON.stringify(draft) === JSON.stringify(ad)) {
      return;
    }
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await persist(draft);
      setSaveStatus("saved");
    }, 800);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const [saving, setSaving] = useState(false);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  function set<K extends keyof Ad>(key: K, value: Ad[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  // Helpers for the multi-entry URL fields (destination_urls, whitelisting_pages).
  function addToList(key: "destination_urls" | "whitelisting_pages") {
    setDraft((d) => ({ ...d, [key]: [...(d[key] ?? []), ""] }));
  }
  function updateListItem(key: "destination_urls" | "whitelisting_pages", idx: number, value: string) {
    setDraft((d) => {
      const arr = [...(d[key] ?? [])];
      arr[idx] = value;
      return { ...d, [key]: arr };
    });
  }
  function removeListItem(key: "destination_urls" | "whitelisting_pages", idx: number) {
    setDraft((d) => {
      const arr = [...(d[key] ?? [])];
      arr.splice(idx, 1);
      return { ...d, [key]: arr };
    });
  }

  // Single source of truth for what fields get written.
  async function persist(d: Ad) {
    await onSave(ad.id, {
      dtc_number: d.dtc_number,
      ad_name: d.ad_name,
      product: d.product,
      persona: d.persona,
      sub_avatar: d.sub_avatar,
      core_emotion: d.core_emotion,
      problem: d.problem,
      awareness: d.awareness,
      angle: d.angle,
      concept: d.concept,
      priority: d.priority,
      assigned_strategist: d.assigned_strategist,
      assigned_editor: d.assigned_editor,
      assigned_media_buyer: d.assigned_media_buyer,
      format: d.format,
      ad_type: d.ad_type,
      content_source: d.content_source,
      due_date: d.due_date,
      brief_link: d.brief_link,
      frame_io_link: d.frame_io_link,
      destination_urls: d.destination_urls,
      whitelisting_pages: d.whitelisting_pages,
      notes: d.notes,
      result: d.result,
      spend: d.spend,
      purchases: d.purchases,
      cvr: d.cvr,
      learning: d.learning,
    });
  }

  // Manual "Save changes" button — saves now and shows saved status.
  async function saveFields() {
    setSaving(true);
    setSaveStatus("saving");
    await persist(draft);
    setSaving(false);
    setSaveStatus("saved");
  }

  // Attempt to move to a target stage. Runs the gate first.
  async function moveToStage(target: string) {
    if (!allowMove) {
      setGateMsg("You don’t have permission to move this ad’s stage.");
      return;
    }
    setGateMsg(null);
    const { allowed, missing } = checkMove(draft, draft.stage, target);

    if (!allowed) {
      setGateMsg(
        `Can’t move to ${target} yet. Fill first: ${missing.join(", ")}.`
      );
      return;
    }

    // Save any pending field edits together with the stage change.
    setSaving(true);
    setSaveStatus("saving");
    const updated = { ...draft, stage: target };
    setDraft(updated);
    await onSave(ad.id, {
      stage: target,
      // include edits so nothing is lost
      persona: draft.persona,
      core_emotion: draft.core_emotion,
      problem: draft.problem,
      awareness: draft.awareness,
      assigned_editor: draft.assigned_editor,
      brief_link: draft.brief_link,
      destination_url: draft.destination_url,
      result: draft.result,
      spend: draft.spend,
      purchases: draft.purchases,
      cvr: draft.cvr,
      learning: draft.learning,
    });
    setSaving(false);
    setSaveStatus("saved");
  }

  const personas = valuesFor("persona");
  const emotions = valuesFor("core_emotion");
  const problems = valuesFor("problem");
  const awarenesses = valuesFor("awareness");
  const formats = valuesFor("format");
  const priorities = valuesFor("priority");
  const subAvatars = valuesFor("sub_avatar");
  const angles = valuesFor("angle");
  const concepts = valuesFor("concept");
  const adTypes = valuesFor("ad_type");
  const contentSources = valuesFor("content_source");
  const products = valuesFor("product");
  const editors = editorOptions;
  const strategists = strategistOptions;
  const mediaBuyers = mediaBuyerOptions;

  // Safety: never render if we somehow have no ad/draft.
  if (!draft) return null;

  const curIdx = stageIndex(draft.stage);
  const nextStage = curIdx < STAGE_ORDER.length - 1 ? STAGE_ORDER[curIdx + 1] : null;
  const isClosed = draft.stage === "Winner / Killed";

  // Number input helper.
  function numOrNull(v: string): number | null {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "640px",
          maxHeight: "88vh",
          overflowY: "auto",
          backgroundColor: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "24px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "20px",
          }}
        >
          <div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "2px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>
                {draft.dtc_number != null ? `DTC #${draft.dtc_number}` : "No DTC #"}
                {"  ·  "}
                {draft.stage}
              </span>
              {saveStatus === "saving" && <span style={{ color: "var(--text-secondary)" }}>· Saving…</span>}
              {saveStatus === "saved" && <span style={{ color: "#4ade80" }}>· All changes saved</span>}
            </div>
            <input
              value={draft.ad_name ?? ""}
              onChange={(e) => set("ad_name", e.target.value)}
              disabled={!allowTitle}
              title={allowTitle ? "" : "Only Founder or Strategist can edit the title"}
              placeholder="Untitled"
              style={{
                fontSize: "18px",
                fontWeight: 600,
                color: "var(--text)",
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: "6px",
                padding: "2px 6px",
                margin: "-2px -6px",
                fontFamily: "inherit",
                outline: "none",
                width: "100%",
                maxWidth: "440px",
              }}
              onFocus={(e) => {
                e.currentTarget.style.border = "1px solid var(--border)";
                e.currentTarget.style.backgroundColor = "var(--nested)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = "1px solid transparent";
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            />
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ---- Stage control ---- */}
        <div
          style={{
            backgroundColor: "var(--nested)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            padding: "14px",
            marginBottom: "20px",
          }}
        >
          <div style={{ ...labelStyle, marginBottom: "10px" }}>Stage</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {STAGE_ORDER.map((s) => {
              const active = s === draft.stage;
              return (
                <button
                  key={s}
                  onClick={() => moveToStage(s)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "6px",
                    border: active ? "none" : "1px solid var(--border)",
                    backgroundColor: active ? "var(--accent)" : "transparent",
                    color: active ? "#0d0d0f" : "var(--text-secondary)",
                    fontSize: "12px",
                    fontWeight: active ? 600 : 400,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>

          {/* Quick "advance" button */}
          {nextStage && (
            <button
              onClick={() => moveToStage(nextStage)}
              style={{
                marginTop: "12px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 12px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--raised)",
                color: "var(--text)",
                fontSize: "13px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <ArrowRight size={14} /> Advance to {nextStage}
            </button>
          )}

          {/* Gate block message */}
          {gateMsg && (
            <div
              style={{
                marginTop: "12px",
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                backgroundColor: "#422006",
                border: "1px solid #854d0e",
                color: "#fcd34d",
                padding: "10px 12px",
                borderRadius: "8px",
                fontSize: "13px",
                lineHeight: 1.4,
              }}
            >
              <Lock size={15} style={{ flexShrink: 0, marginTop: "1px" }} />
              <span>{gateMsg}</span>
            </div>
          )}
        </div>

        {/* ---- ZONE 1: STRATEGY ---- */}
        <div style={sectionTitle}>Zone 1 · Strategy</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px", borderLeft: "2px solid #7c3aed", paddingLeft: "14px", opacity: allowZone1 ? 1 : 0.55, pointerEvents: allowZone1 ? "auto" : "none" }}>
          <div>
            <label style={labelStyle}>Persona</label>
            <select style={inputStyle} value={draft.persona ?? ""} onChange={(e) => set("persona", e.target.value || null)}>
              <option value="">—</option>
              {personas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Sub avatar</label>
            <select style={inputStyle} value={draft.sub_avatar ?? ""} onChange={(e) => set("sub_avatar", e.target.value || null)}>
              <option value="">—</option>
              {subAvatars.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Core Emotion</label>
            <select style={inputStyle} value={draft.core_emotion ?? ""} onChange={(e) => set("core_emotion", e.target.value || null)}>
              <option value="">—</option>
              {emotions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Problem</label>
            <select style={inputStyle} value={draft.problem ?? ""} onChange={(e) => set("problem", e.target.value || null)}>
              <option value="">—</option>
              {problems.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Awareness</label>
            <select style={inputStyle} value={draft.awareness ?? ""} onChange={(e) => set("awareness", e.target.value || null)}>
              <option value="">—</option>
              {awarenesses.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Angle</label>
            <select style={inputStyle} value={draft.angle ?? ""} onChange={(e) => set("angle", e.target.value || null)}>
              <option value="">—</option>
              {angles.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Concept</label>
            <select style={inputStyle} value={draft.concept ?? ""} onChange={(e) => set("concept", e.target.value || null)}>
              <option value="">—</option>
              {concepts.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {/* ---- ZONE 2: OPERATIONAL ---- */}
        <div style={sectionTitle}>Zone 2 · Operational</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
          <div>
            <label style={labelStyle}>Strategist</label>
            <select style={inputStyle} value={draft.assigned_strategist ?? ""} onChange={(e) => set("assigned_strategist", e.target.value || null)}>
              <option value="">—</option>
              {strategists.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Editor</label>
            <select style={inputStyle} value={draft.assigned_editor ?? ""} onChange={(e) => set("assigned_editor", e.target.value || null)}>
              <option value="">—</option>
              {editors.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Media Buyer</label>
            <select style={inputStyle} value={draft.assigned_media_buyer ?? ""} onChange={(e) => set("assigned_media_buyer", e.target.value || null)}>
              <option value="">—</option>
              {mediaBuyers.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Product</label>
            <select style={inputStyle} value={draft.product ?? ""} onChange={(e) => set("product", e.target.value || null)}>
              <option value="">—</option>
              {products.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Format</label>
            <select style={inputStyle} value={draft.format ?? ""} onChange={(e) => set("format", e.target.value || null)}>
              <option value="">—</option>
              {formats.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Ad type</label>
            <select style={inputStyle} value={draft.ad_type ?? ""} onChange={(e) => set("ad_type", e.target.value || null)}>
              <option value="">—</option>
              {adTypes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Content source</label>
            <select style={inputStyle} value={draft.content_source ?? ""} onChange={(e) => set("content_source", e.target.value || null)}>
              <option value="">—</option>
              {contentSources.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={draft.priority ?? ""} onChange={(e) => set("priority", e.target.value || null)}>
              <option value="">—</option>
              {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Due date</label>
            <input type="date" style={inputStyle} value={draft.due_date ?? ""} onChange={(e) => set("due_date", e.target.value || null)} />
          </div>
          <div>
            <label style={labelStyle}>Brief link</label>
            <input style={inputStyle} value={draft.brief_link ?? ""} onChange={(e) => set("brief_link", e.target.value || null)} placeholder="https://" />
          </div>
          <div>
            <label style={labelStyle}>Frame.io link</label>
            <input style={inputStyle} value={draft.frame_io_link ?? ""} onChange={(e) => set("frame_io_link", e.target.value || null)} placeholder="https://" />
          </div>
        </div>

        {/* Multiple destination URLs */}
        <div style={{ marginBottom: "16px" }}>
          <label style={labelStyle}>Destination URLs</label>
          {(draft.destination_urls ?? []).map((url, i) => (
            <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
              <input
                style={inputStyle}
                value={url}
                onChange={(e) => updateListItem("destination_urls", i, e.target.value)}
                placeholder="https://"
              />
              <button
                onClick={() => removeListItem("destination_urls", i)}
                style={{ padding: "0 10px", backgroundColor: "transparent", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() => addToList("destination_urls")}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", backgroundColor: "transparent", border: "1px dashed var(--border)", borderRadius: "6px", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
          >
            <Plus size={13} /> Add URL
          </button>
        </div>

        {/* Multiple whitelisting pages */}
        <div style={{ marginBottom: "20px" }}>
          <label style={labelStyle}>Whitelisting pages</label>
          {(draft.whitelisting_pages ?? []).map((url, i) => (
            <div key={i} style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
              <input
                style={inputStyle}
                value={url}
                onChange={(e) => updateListItem("whitelisting_pages", i, e.target.value)}
                placeholder="Page / handle"
              />
              <button
                onClick={() => removeListItem("whitelisting_pages", i)}
                style={{ padding: "0 10px", backgroundColor: "transparent", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() => addToList("whitelisting_pages")}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", backgroundColor: "transparent", border: "1px dashed var(--border)", borderRadius: "6px", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
          >
            <Plus size={13} /> Add page
          </button>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: "20px" }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            style={{ ...inputStyle, minHeight: "56px", resize: "vertical" }}
            value={draft.notes ?? ""}
            onChange={(e) => set("notes", e.target.value || null)}
            placeholder="Optional context for the team…"
          />
        </div>

        {/* ---- END OF LIFE: PERFORMANCE + LEARNING ---- */}
        <div style={sectionTitle}>Close-out · Performance &amp; Learning</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "8px", opacity: allowPerf ? 1 : 0.55, pointerEvents: allowPerf ? "auto" : "none" }}>
          <div>
            <label style={labelStyle}>Result</label>
            <select style={inputStyle} value={draft.result ?? ""} onChange={(e) => set("result", e.target.value || null)}>
              <option value="">—</option>
              <option value="Winner">Winner</option>
              <option value="Killed">Killed</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Spend</label>
            <input style={inputStyle} value={draft.spend ?? ""} onChange={(e) => set("spend", numOrNull(e.target.value))} inputMode="decimal" />
          </div>
          <div>
            <label style={labelStyle}>Purchases</label>
            <input style={inputStyle} value={draft.purchases ?? ""} onChange={(e) => set("purchases", numOrNull(e.target.value))} inputMode="decimal" />
          </div>
          <div>
            <label style={labelStyle}>CVR (%)</label>
            <input style={inputStyle} value={draft.cvr ?? ""} onChange={(e) => set("cvr", numOrNull(e.target.value))} inputMode="decimal" />
          </div>
        </div>
        <div style={{ marginBottom: "20px" }}>
          <label style={labelStyle}>Learning (required to close)</label>
          <textarea
            style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
            value={draft.learning ?? ""}
            onChange={(e) => set("learning", e.target.value || null)}
            placeholder="One line: what did this ad teach us?"
          />
        </div>

        {/* CPA preview (auto-calculated, never stored) */}
        {draft.spend != null && draft.purchases != null && draft.purchases > 0 && (
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "20px" }}>
            CPA (auto): {(draft.spend / draft.purchases).toFixed(2)}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
          {/* Delete (left side) — Founder/Strategist only */}
          {allowDelete && !confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "8px 12px", backgroundColor: "transparent",
                border: "1px solid var(--border)", borderRadius: "6px",
                color: "#fca5a5", fontSize: "13px", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          ) : allowDelete && confirmingDelete ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Delete this ad?</span>
              <button
                onClick={async () => { await onDelete(ad.id); onClose(); }}
                style={{
                  padding: "6px 12px", backgroundColor: "#7f1d1d", border: "none",
                  borderRadius: "6px", color: "#fee2e2", fontSize: "13px", fontWeight: 500,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                style={{
                  padding: "6px 12px", backgroundColor: "transparent",
                  border: "1px solid var(--border)", borderRadius: "6px",
                  color: "var(--text-secondary)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <span />
          )}

          {/* Close + Save (right side) */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 14px", backgroundColor: "transparent",
                border: "1px solid var(--border)", borderRadius: "6px",
                color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Close
            </button>
            <button
              onClick={saveFields}
              disabled={saving}
              style={{
                padding: "8px 14px", backgroundColor: "var(--accent)", border: "none",
                borderRadius: "6px", color: "#0d0d0f", fontSize: "14px", fontWeight: 500,
                cursor: saving ? "default" : "pointer", fontFamily: "inherit",
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
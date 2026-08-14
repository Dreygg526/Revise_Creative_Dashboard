"use client";

import { useState, useEffect, useRef } from "react";
import { X, Lock, ArrowRight, Trash2, Plus, Copy, Check, Send, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { useSettings } from "@/app/hooks/useSettings";
import { useMyRole } from "@/app/hooks/useMyRole";
import { useMyName } from "@/app/hooks/useMyName";
import { can } from "@/app/lib/permissions";
import CloseOutModal from "@/app/components/modals/CloseOutModal";
import PreLaunchModal from "@/app/components/modals/PreLaunchModal";
import { STAGE_ORDER, checkMove, stageIndex, isSelfProduced } from "@/app/lib/gates";
import type { Ad, MetaBreakdownRow } from "@/app/types";

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
  const { valuesFor, strategistOptions, editorOptions } = useSettings();
  const myRole = useMyRole();
  const myName = useMyName();
  const allowTitle = can(myRole, "edit_title");
  const allowZone1 = can(myRole, "edit_zone1");
  const allowZone2 = can(myRole, "edit_zone2");
  const allowMove = can(myRole, "move_stage");
  const allowDelete = can(myRole, "delete_ad");
  const allowPerf = can(myRole, "edit_performance");
  const allowSelfProduce = can(myRole, "self_produce");
  const showAdSetName = myRole === "Media Buyer" || myRole === "Founder";

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
  const [showCloseOut, setShowCloseOut] = useState(false);
  const [showPreLaunch, setShowPreLaunch] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [copied, setCopied] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [workflowMsg, setWorkflowMsg] = useState<string | null>(null);

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

  // "Self-produced" = the strategist made the creative themselves, so there's
  // no editor handoff to gate. Stored as strategist === editor rather than a
  // new column, which keeps a real name in assigned_editor for My Queue,
  // Workload, Reports and the ad-set name. See isSelfProduced() in gates.ts.
  function toggleSelfProduced(on: boolean) {
    setDraft((d) => {
      if (!on) return { ...d, assigned_editor: null };
      // Fall back to the logged-in user when no strategist is assigned yet.
      const who = d.assigned_strategist || myName;
      if (!who) return d;
      return { ...d, assigned_strategist: who, assigned_editor: who };
    });
  }

  // Single source of truth for what fields get written.
  async function persist(d: Ad) {
    await onSave(ad.id, {
      dtc_number: d.dtc_number,
      ad_name: d.ad_name,
      product: d.product,
      persona: d.persona,
      core_emotion: d.core_emotion,
      problem: d.problem,
      awareness: d.awareness,
      angle: d.angle,
      priority: d.priority,
      assigned_strategist: d.assigned_strategist,
      assigned_editor: d.assigned_editor,
      format: d.format,
      ad_type: d.ad_type,
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
      meta_ad_id: d.meta_ad_id,
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

    // Ready to Launch -> Testing requires the pre-launch checklist (Media Buyer/Founder).
    if (draft.stage === "Ready to Launch" && target === "Testing") {
      if (myRole !== "Media Buyer" && myRole !== "Founder") {
        setGateMsg("Only the Media Buyer can move an ad into Testing (pre-launch checklist).");
        return;
      }
      // Still enforce the field gate (destination URL) before showing the checklist.
      const { allowed, missing } = checkMove(draft, draft.stage, target);
      if (!allowed) {
        setGateMsg("Can’t move to Testing yet. Fill first: " + missing.join(", ") + ".");
        return;
      }
      setShowPreLaunch(true);
      return;
    }

    // Closing out (Winner / Killed) requires the forced-capture modal.
    if (target === "Winner / Killed") {
      if (!can(myRole, "edit_performance")) {
        setGateMsg("You don’t have permission to close out this ad.");
        return;
      }
      setShowCloseOut(true);
      return;
    }

    const { allowed, missing } = checkMove(draft, draft.stage, target);

    if (!allowed) {
      // Point strategists at the escape hatch instead of making them find it.
      const hint =
        allowSelfProduce && missing.includes("Editor")
          ? " Or tick “Self-produced” under Zone 2 if you made this one yourself."
          : "";
      setGateMsg(
        `Can’t move to ${target} yet. Fill first: ${missing.join(", ")}.` + hint
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

  // Called by the PreLaunchModal once all checks pass.
  // ---- Submit / Approve / Request-revision workflow ----
  const canReview = can(myRole, "review_ad"); // Founder + Strategist + Editor + Graphic Designer

  async function submitForReview() {
    setWorkflowMsg(null);
    // Require both a specific strategist and editor so the ping has a target.
    if (!draft.assigned_strategist) { setWorkflowMsg("Assign a strategist before submitting for review."); return; }
    if (!draft.assigned_editor) { setWorkflowMsg("Assign an editor before submitting for review."); return; }
    const updated = { ...draft, stage: "Review" };
    setDraft(updated);
    await onSave(ad.id, { stage: "Review", assigned_strategist: draft.assigned_strategist, assigned_editor: draft.assigned_editor });
  }

  async function approve() {
    setWorkflowMsg(null);
    const updated = { ...draft, stage: "Ready to Launch" };
    setDraft(updated);
    await onSave(ad.id, { stage: "Ready to Launch" });
  }

  async function requestRevision() {
    setWorkflowMsg(null);
    const newCount = (draft.revision_count ?? 0) + 1;
    const updated = { ...draft, stage: "In Production", revision_count: newCount };
    setDraft(updated);
    // Feedback is given in Frame.io, so no in-app note is stored.
    await onSave(ad.id, { stage: "In Production", revision_count: newCount });
  }

  async function confirmPreLaunch() {
    const updated = { ...draft, stage: "Testing" };
    setDraft(updated);
    setSaving(true);
    setSaveStatus("saving");
    await onSave(ad.id, { stage: "Testing" });
    setSaving(false);
    setSaveStatus("saved");
    setShowPreLaunch(false);
  }

  // Called by the CloseOutModal once the user fills the required capture.
  async function confirmCloseOut(data: {
    result: "Winner" | "Killed";
    spend: number;
    purchases: number;
    cvr: number;
    learning: string;
  }) {
    const updated = {
      ...draft,
      stage: "Winner / Killed",
      result: data.result,
      spend: data.spend,
      purchases: data.purchases,
      cvr: data.cvr,
      learning: data.learning,
    };
    setDraft(updated);
    setSaving(true);
    setSaveStatus("saving");
    await onSave(ad.id, {
      stage: "Winner / Killed",
      result: data.result,
      spend: data.spend,
      purchases: data.purchases,
      cvr: data.cvr,
      learning: data.learning,
    });
    setSaving(false);
    setSaveStatus("saved");
    setShowCloseOut(false);
  }

  const personas = valuesFor("persona");
  const emotions = valuesFor("core_emotion");
  const problems = valuesFor("problem");
  const awarenesses = valuesFor("awareness");
  const formats = valuesFor("format");
  const priorities = valuesFor("priority");
  const angles = valuesFor("angle");
  const adTypes = valuesFor("ad_type");
  const products = valuesFor("product");
  const editors = editorOptions;
  const strategists = strategistOptions;

  // Safety: never render if we somehow have no ad/draft.
  if (!draft) return null;

  const workflowBtn = (bg: string, color: string): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px",
    borderRadius: "6px", border: "none", backgroundColor: bg, color,
    fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
  });

  const curIdx = stageIndex(draft.stage);
  const nextStage = curIdx < STAGE_ORDER.length - 1 ? STAGE_ORDER[curIdx + 1] : null;
  const isClosed = draft.stage === "Winner / Killed";

  // Self-produced state. `selfProduceWho` is the name that would be recorded —
  // null means we have nobody to attribute it to, so the box stays disabled.
  const selfProduced = isSelfProduced(draft);
  const selfProduceWho = draft.assigned_strategist || myName;

  // Number input helper.

  // Build the ad-set name string from the boss's format.
  // Empty fields show a [placeholder] so it's clear what's missing.
  function buildAdSetName(): string {
    const wl = (draft.whitelisting_pages ?? []).filter((u) => u && u.trim());
    const part = (val: string | null | undefined, ph: string) =>
      val && String(val).trim() ? String(val) : `[${ph}]`;

    return [
      draft.dtc_number != null ? `DTC #${draft.dtc_number}` : "[DTC #]",
      part(draft.format, "format"),
      wl.length > 0 ? wl.join(" & ") : "[whitelisting]",
      part(draft.angle, "angle"),
      part(draft.awareness, "awareness"),
      part(draft.ad_type, "ad_type"),
      `Editor: ${draft.assigned_editor || "[editor]"}`,
      `Strategist: ${draft.assigned_strategist || "[strategist]"}`,
    ].join(" || ");
  }

  async function copyAdSetName() {
    try {
      await navigator.clipboard.writeText(buildAdSetName());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be blocked; ignore silently
    }
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

          {/* ---- Workflow actions ---- */}
          <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {draft.stage === "In Production" && (
              <button onClick={submitForReview} style={workflowBtn("#2563eb", "#fff")}>
                <Send size={13} /> Submit for review
              </button>
            )}
            {draft.stage === "Review" && canReview && (
              <>
                <button onClick={approve} style={workflowBtn("#16a34a", "#fff")}>
                  <Check size={13} /> Approve
                </button>
                <button onClick={requestRevision} style={workflowBtn("var(--raised)", "#fca5a5")}>
                  <RotateCcw size={13} /> Request revision
                </button>
              </>
            )}
          </div>

          {workflowMsg && (
            <div style={{ marginTop: "10px", backgroundColor: "#422006", border: "1px solid #854d0e", color: "#fcd34d", padding: "9px 12px", borderRadius: "8px", fontSize: "13px" }}>
              {workflowMsg}
            </div>
          )}
        </div>

        {/* ---- AD-SET NAME (auto-generated) — Media Buyer + Founder only ---- */}
        {showAdSetName && (
        <div style={{
          backgroundColor: "var(--nested)", border: "1px solid var(--border)",
          borderRadius: "10px", padding: "12px 14px", marginBottom: "20px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Ad-set name</span>
            <button
              onClick={copyAdSetName}
              style={{
                display: "flex", alignItems: "center", gap: "5px",
                padding: "4px 10px", backgroundColor: "var(--raised)",
                border: "1px solid var(--border)", borderRadius: "6px",
                color: copied ? "#4ade80" : "var(--text-secondary)",
                fontSize: "12px", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div style={{
            fontSize: "12px", color: "var(--text)", lineHeight: 1.5,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            wordBreak: "break-word",
          }}>
            {buildAdSetName()}
          </div>
        </div>
        )}

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
        </div>

        {/* ---- ZONE 2: OPERATIONAL ---- */}
        <div style={sectionTitle}>Zone 2 · Operational</div>
        <div style={{ opacity: allowZone2 ? 1 : 0.55, pointerEvents: allowZone2 ? "auto" : "none" }}>
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
            {selfProduced ? (
              // The strategist isn't in the editor dropdown, so the select would
              // render blank against their own name. Show it as text instead.
              <div style={{ ...inputStyle, color: "var(--text-secondary)" }}>
                {draft.assigned_editor} · self-produced
              </div>
            ) : (
              <select style={inputStyle} value={draft.assigned_editor ?? ""} onChange={(e) => set("assigned_editor", e.target.value || null)}>
                <option value="">—</option>
                {editors.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            )}
          </div>

          {/* Self-produced escape hatch — Founders + Strategists only. */}
          {allowSelfProduce && (
            <label
              title={
                selfProduceWho
                  ? "Skips the brief link and editor requirements for this ad only."
                  : "Assign a strategist first — the ad needs a name to record as its producer."
              }
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                color: selfProduceWho ? "var(--text-secondary)" : "var(--text-muted)",
                cursor: selfProduceWho ? "pointer" : "not-allowed",
              }}
            >
              <input
                type="checkbox"
                checked={selfProduced}
                disabled={!selfProduceWho}
                onChange={(e) => toggleSelfProduced(e.target.checked)}
                style={{ width: "14px", height: "14px", accentColor: "var(--accent)", cursor: "inherit" }}
              />
              <span>Self-produced — I made this myself, no editor needed</span>
            </label>
          )}

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

        </div>{/* end Zone 2 dim wrapper */}

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

        {/* ---- META LINK + SYNCED PERFORMANCE ---- */}
        <div style={sectionTitle}>Meta</div>
        <div style={{ marginBottom: "20px", backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "10px", padding: "14px" }}>
          {/* What the last sync found for this ad. Read-only. */}
          {draft.meta_synced_at ? (
            <div style={{ marginBottom: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "8px" }}>
                <MetaStat label="Spend" value={draft.meta_spend != null ? draft.meta_spend.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"} />
                <MetaStat label="Purchases" value={draft.meta_purchases != null ? String(draft.meta_purchases) : "—"} />
                <MetaStat label="CVR" value={draft.meta_cvr != null ? draft.meta_cvr.toFixed(2) + "%" : "—"} />
                <MetaStat
                  label="CPA"
                  value={
                    draft.meta_spend != null && draft.meta_purchases != null && draft.meta_purchases > 0
                      ? (draft.meta_spend / draft.meta_purchases).toFixed(2)
                      : "—"
                  }
                />
              </div>
              {/* The numbers above are a SUM. When several Meta ads rolled up,
                  the blended CPA says nothing about any one creative, so the
                  match is expandable rather than a wall of names. */}
              {draft.meta_matched_count && draft.meta_matched_count > 1 ? (
                <button
                  onClick={() => setShowBreakdown((v) => !v)}
                  style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "4px 8px 4px 5px", marginBottom: showBreakdown ? "10px" : "6px",
                    backgroundColor: "transparent", border: "1px solid var(--border)",
                    borderRadius: "6px", color: "var(--text-secondary)",
                    fontSize: "11px", cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {showBreakdown ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  Matched {draft.meta_matched_count} Meta ads — {showBreakdown ? "hide" : "show"} the split
                </button>
              ) : null}

              {showBreakdown && draft.meta_matched_count && draft.meta_matched_count > 1 ? (
                <MetaBreakdown rows={draft.meta_breakdown} names={draft.meta_matched_name} />
              ) : null}

              <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                {!draft.meta_matched_count || draft.meta_matched_count <= 1
                  ? `Matched${draft.meta_matched_name ? ` · ${draft.meta_matched_name}` : ""}`
                  : "Matched"}
                {draft.meta_match_method ? ` · via ${draft.meta_match_method.replace("_", " ")}` : ""}
                {` · synced ${new Date(draft.meta_synced_at).toLocaleString()}`}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "14px", lineHeight: 1.5 }}>
              No Meta data yet. The sync matches on the DTC number inside the Meta ad name —
              name this ad’s Meta creative something containing
              <strong style={{ color: "var(--text-secondary)" }}>
                {draft.dtc_number != null ? ` “DTC ${draft.dtc_number}”` : " its DTC number"}
              </strong>
              , or paste the Meta ad ID below to link it directly.
            </div>
          )}

          {/* Manual override — the escape hatch when name matching can't figure it out. */}
          <div style={{ opacity: allowPerf ? 1 : 0.55, pointerEvents: allowPerf ? "auto" : "none" }}>
            <label style={labelStyle}>Meta ad ID (manual link)</label>
            <input
              style={inputStyle}
              value={draft.meta_ad_id ?? ""}
              onChange={(e) => set("meta_ad_id", e.target.value.trim() || null)}
              placeholder="e.g. 23851234567890123 — overrides name matching"
            />
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "5px" }}>
              Copy this from Ads Manager, or from the unmatched list after a sync on the Analytics page.
            </div>
          </div>
        </div>

        {/* ---- END OF LIFE: PERFORMANCE + LEARNING ---- */}
        {/* ---- GENERATED COPY (from Copy Agent) ---- */}
        {(draft.selected_headline || draft.selected_ad_copy) && (
          <div style={{ marginBottom: "20px", backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "10px", padding: "14px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>Generated copy</div>
            {draft.selected_headline && (
              <div style={{ marginBottom: "10px" }}>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "3px" }}>Headline</div>
                <div style={{ fontSize: "14px", color: "var(--text)", lineHeight: 1.5 }}>{draft.selected_headline}</div>
              </div>
            )}
            {draft.selected_ad_copy && (
              <div>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "3px" }}>Ad copy</div>
                <div style={{ fontSize: "14px", color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{draft.selected_ad_copy}</div>
              </div>
            )}
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
    
      {showPreLaunch && (
        <PreLaunchModal
          ad={draft}
          onClose={() => setShowPreLaunch(false)}
          onConfirm={confirmPreLaunch}
        />
      )}

      {showCloseOut && (
        <CloseOutModal
          ad={draft}
          onClose={() => setShowCloseOut(false)}
          onConfirm={confirmCloseOut}
        />
      )}
      </div>
  );
}

// Read-only stat tile for the synced Meta numbers.
// ------------------------------------------------------------
// PER-META-AD BREAKDOWN
// ------------------------------------------------------------
// A brief's meta_* numbers are a SUM over every Meta ad whose name (or ad set
// name) carried its DTC number — variants, .1/.2 iterations, duplicated ad
// sets, relaunches. DTC #21 sums 70 of them. That total is correct but it is
// not a finding: one blended CPA across 70 creatives buries both the ad
// carrying the brief and the ones bleeding out.
//
// Two views, deliberately in this order:
//   1. By DTC variant — only when the names disagree about the decimal.
//      The matcher collapses #21.1 into #21; this is the only place that
//      shows what that assumption is costing, so it goes first.
//   2. Every Meta ad, highest spend first.
const money = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 0 });

const cpaOf = (spend: number, purchases: number) =>
  purchases > 0 ? (spend / purchases).toFixed(2) : "—";

const roasOf = (revenue: number, spend: number) =>
  spend > 0 ? (revenue / spend).toFixed(2) + "x" : "—";

// One hue for every bar. Colouring by rank would make the hue meaningless.
const BAR = "#3987e5";

// Ads Manager link for a single Meta ad, in the account that ad belongs to.
// No account recorded (rows synced before the multi-account fix) means no
// link — a link to a guessed account lands on an empty telescope, which is
// worse than no link at all.
//
// business_id matters: without it Facebook resolves `act=` in your personal
// scope, and an account it can't resolve there silently redirects to your own
// ad account instead of erroring. Every working Ads Manager URL from this
// business carries it.
export const META_BUSINESS_ID = (process.env.NEXT_PUBLIC_META_BUSINESS_ID || "1888429485321387").trim();

export function adRowUrl(r: MetaBreakdownRow): string | null {
  const acct = (r.account_id ?? "").replace(/^act_/, "").trim();
  if (!/^\d+$/.test(acct) || !r.ad_id) return null;
  return (
    `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${acct}` +
    (META_BUSINESS_ID ? `&business_id=${META_BUSINESS_ID}&global_scope_id=${META_BUSINESS_ID}` : "") +
    `&selected_ad_ids=${r.ad_id}`
  );
}

const cell: React.CSSProperties = {
  fontSize: "11px",
  color: "var(--text)",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
};

const headCell: React.CSSProperties = {
  ...cell,
  color: "var(--text-muted)",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const GRID = "1fr 62px 46px 56px 46px";

function MetaBreakdown({ rows, names }: { rows: MetaBreakdownRow[] | null; names: string | null }) {
  // Pre-v5 databases, and any ad synced before v5 was applied, have the joined
  // name string but no rows. Show what we have rather than an empty panel.
  if (!rows || rows.length === 0) {
    return (
      <div style={{ marginBottom: "10px", padding: "10px", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px" }}>
        <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: names ? "8px" : 0 }}>
          No per-ad breakdown stored yet — run a sync to record which Meta ads fed these totals.
        </div>
        {names ? (
          <div style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5 }}>{names}</div>
        ) : null}
      </div>
    );
  }

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);

  // Group by the un-collapsed DTC token: "21" and "21.1" land in separate
  // buckets here even though the matcher summed them into one brief.
  const byVariant = new Map<string, { spend: number; purchases: number; revenue: number; count: number }>();
  for (const r of rows) {
    const key = r.variant ?? "no DTC in name";
    const g = byVariant.get(key) ?? { spend: 0, purchases: 0, revenue: 0, count: 0 };
    g.spend += r.spend;
    g.purchases += r.purchases;
    g.revenue += r.revenue;
    g.count += 1;
    byVariant.set(key, g);
  }
  const variants = [...byVariant.entries()].sort((a, b) => b[1].spend - a[1].spend);

  return (
    <div style={{ marginBottom: "12px", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
      {variants.length > 1 ? (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: "10px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
            By DTC variant
          </div>
          {variants.map(([label, g]) => (
            <div key={label} style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", marginBottom: "3px" }}>
                <span style={{ fontSize: "11px", color: "var(--text)", fontWeight: 600 }}>
                  {label === "no DTC in name" ? label : `DTC #${label}`}
                  <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                    {"  "}{g.count} {g.count === 1 ? "ad" : "ads"}
                  </span>
                </span>
                <span style={{ ...cell, color: "var(--text-secondary)" }}>
                  {money(g.spend)} · {totalSpend > 0 ? Math.round((g.spend / totalSpend) * 100) : 0}% · CPA {cpaOf(g.spend, g.purchases)}
                </span>
              </div>
              <div style={{ height: "4px", backgroundColor: "var(--nested)", borderRadius: "2px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${totalSpend > 0 ? (g.spend / totalSpend) * 100 : 0}%`, backgroundColor: BAR, borderRadius: "2px" }} />
              </div>
            </div>
          ))}
          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.5, marginTop: "6px" }}>
            Decimal DTCs are treated as iterations of the same brief and summed into it. If
            they&rsquo;re meant to be separate briefs, this split is what&rsquo;s being hidden.
          </div>
        </div>
      ) : null}

      <div style={{ padding: "10px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: "8px", paddingBottom: "6px", borderBottom: "1px solid var(--border)", marginBottom: "6px" }}>
          <div style={{ ...headCell, textAlign: "left" }}>Meta ad</div>
          <div style={headCell}>Spend</div>
          <div style={headCell}>Purch</div>
          <div style={headCell}>CPA</div>
          <div style={headCell}>ROAS</div>
        </div>

        {/* Long lists scroll inside the panel rather than pushing the rest of
            the modal (the manual override field) out of reach. */}
        <div style={{ maxHeight: "300px", overflowY: "auto" }}>
          {rows.map((r) => (
            <div
              key={r.ad_id}
              style={{ display: "grid", gridTemplateColumns: GRID, gap: "8px", alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border)" }}
            >
              <div style={{ minWidth: 0 }}>
                {/* Linked per row, using the row's OWN account. This shop runs
                    six Meta ad accounts, and an ad opened against the wrong
                    one reads as "No ads found" — which looks exactly like the
                    match being invented. */}
                {adRowUrl(r) ? (
                  <a
                    href={adRowUrl(r)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: "11px", color: "var(--text)", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={`${r.ad_name} — open in Ads Manager (${r.account_id})`}
                  >
                    {r.ad_name}
                  </a>
                ) : (
                  <div style={{ fontSize: "11px", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.ad_name}>
                    {r.ad_name}
                  </div>
                )}
                {/* The account is shown, not just linked. This shop runs six,
                    and "which account is this in" turned out to be the single
                    most confusing thing about the roll-up. */}
                {r.account_id || r.adset_name ? (
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${r.account_id ?? ""} ${r.adset_name ?? ""}`.trim()}>
                    {r.account_id ? (
                      <span style={{ color: "var(--text-secondary)" }}>{r.account_id}</span>
                    ) : null}
                    {r.account_id && r.adset_name ? " · " : ""}
                    {r.adset_name ?? ""}
                  </div>
                ) : null}
              </div>
              <div style={cell}>{money(r.spend)}</div>
              <div style={cell}>{r.purchases}</div>
              <div style={cell}>{cpaOf(r.spend, r.purchases)}</div>
              <div style={{ ...cell, color: "var(--text-secondary)" }}>{roasOf(r.revenue, r.spend)}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.5, marginTop: "8px" }}>
          Highest spend first. ROAS is revenue ÷ ad spend and is margin-blind — 1.00x means the
          ad spend came back, not that it made money.
        </div>
      </div>
    </div>
  );
}

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "2px" }}>
        {label}
      </div>
      <div style={{ fontSize: "15px", color: "var(--text)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}
"use client";

import { useState } from "react";
import { X, Check, Rocket } from "lucide-react";
import type { Ad } from "@/app/types";

// Default pre-launch checks. Editable here if the team's process changes.
const CHECKLIST_ITEMS = [
  "Destination URL(s) set and working",
  "Tracking / UTM in place",
  "Creative uploaded to Ads Manager",
  "Budget & audience configured",
];

interface Props {
  ad: Ad;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export default function PreLaunchModal({ ad, onClose, onConfirm }: Props) {
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST_ITEMS.map(() => false));
  const [saving, setSaving] = useState(false);

  const allChecked = checked.every(Boolean);

  function toggle(i: number) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  async function handleConfirm() {
    if (!allChecked) return;
    setSaving(true);
    await onConfirm();
    setSaving(false);
  }

  return (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: "420px", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <Rocket size={17} /> Pre-launch checklist
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex" }} aria-label="Cancel">
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 20px 0", lineHeight: 1.5 }}>
          {ad.dtc_number != null ? `DTC #${ad.dtc_number} · ` : ""}{ad.ad_name || "Untitled"}. Confirm everything before this goes into Testing.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "22px" }}>
          {CHECKLIST_ITEMS.map((item, i) => (
            <button
              key={i}
              onClick={() => toggle(i)}
              style={{
                display: "flex", alignItems: "center", gap: "10px",
                padding: "11px 12px", textAlign: "left", width: "100%",
                backgroundColor: checked[i] ? "#052e16" : "var(--nested)",
                border: checked[i] ? "1px solid #16a34a" : "1px solid var(--border)",
                borderRadius: "8px", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <span style={{
                width: "18px", height: "18px", borderRadius: "5px", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                backgroundColor: checked[i] ? "#16a34a" : "transparent",
                border: checked[i] ? "none" : "1px solid var(--text-muted)",
              }}>
                {checked[i] && <Check size={13} color="#fff" />}
              </span>
              <span style={{ fontSize: "14px", color: checked[i] ? "#4ade80" : "var(--text)" }}>{item}</span>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button onClick={onClose} style={{ padding: "9px 14px", backgroundColor: "transparent", border: "1px solid var(--border)", borderRadius: "7px", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!allChecked || saving}
            style={{
              padding: "9px 16px", borderRadius: "7px", border: "none", fontFamily: "inherit", fontSize: "14px", fontWeight: 500,
              backgroundColor: allChecked ? "var(--accent)" : "var(--raised)",
              color: allChecked ? "#0d0d0f" : "var(--text-muted)",
              cursor: allChecked && !saving ? "pointer" : "default",
            }}
          >
            {saving ? "Launching…" : "Confirm & move to Testing"}
          </button>
        </div>
      </div>
    </div>
  );
}
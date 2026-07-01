"use client";

import { useState } from "react";
import { X, Trophy, Skull } from "lucide-react";
import type { Ad } from "@/app/types";

interface Props {
  ad: Ad;
  onClose: () => void;
  // Called with the captured data when confirmed.
  onConfirm: (data: {
    result: "Winner" | "Killed";
    spend: number;
    purchases: number;
    cvr: number;
    learning: string;
  }) => Promise<void>;
}

export default function CloseOutModal({ ad, onClose, onConfirm }: Props) {
  const [result, setResult] = useState<"Winner" | "Killed" | null>(
    ad.result === "Winner" || ad.result === "Killed" ? ad.result : null
  );
  const [spend, setSpend] = useState(ad.spend != null ? String(ad.spend) : "");
  const [purchases, setPurchases] = useState(ad.purchases != null ? String(ad.purchases) : "");
  const [cvr, setCvr] = useState(ad.cvr != null ? String(ad.cvr) : "");
  const [learning, setLearning] = useState(ad.learning ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spendN = spend.trim() === "" ? null : Number(spend);
  const purchasesN = purchases.trim() === "" ? null : Number(purchases);
  const cvrN = cvr.trim() === "" ? null : Number(cvr);

  // Live CPA preview.
  const cpa = spendN != null && purchasesN != null && purchasesN > 0
    ? spendN / purchasesN
    : null;

  const valid =
    result != null &&
    spendN != null && !Number.isNaN(spendN) &&
    purchasesN != null && !Number.isNaN(purchasesN) &&
    cvrN != null && !Number.isNaN(cvrN) &&
    learning.trim().length >= 3;

  async function handleConfirm() {
    if (!valid) {
      setError("Please choose an outcome, fill spend, purchases, CVR, and write a learning.");
      return;
    }
    setSaving(true);
    setError(null);
    await onConfirm({
      result: result!,
      spend: spendN!,
      purchases: purchasesN!,
      cvr: cvrN!,
      learning: learning.trim(),
    });
    setSaving(false);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 11px", backgroundColor: "var(--nested)",
    border: "1px solid var(--border)", borderRadius: "7px", color: "var(--text)",
    fontSize: "14px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px",
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "20px" }}
    >
      {/* No click-outside-to-close: this is a forced capture. */}
      <div style={{ width: "100%", maxWidth: "440px", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>Close out this ad</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex" }} aria-label="Cancel">
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 20px 0", lineHeight: 1.5 }}>
          {ad.dtc_number != null ? `DTC #${ad.dtc_number} · ` : ""}{ad.ad_name || "Untitled"}. Capture the result before closing — this can’t be skipped.
        </p>

        {/* Outcome choice */}
        <label style={labelStyle}>Outcome</label>
        <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
          <button
            onClick={() => setResult("Winner")}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
              padding: "10px", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "14px", fontWeight: 500,
              border: result === "Winner" ? "1px solid #16a34a" : "1px solid var(--border)",
              backgroundColor: result === "Winner" ? "#052e16" : "transparent",
              color: result === "Winner" ? "#4ade80" : "var(--text-secondary)",
            }}
          >
            <Trophy size={16} /> Winner
          </button>
          <button
            onClick={() => setResult("Killed")}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
              padding: "10px", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit", fontSize: "14px", fontWeight: 500,
              border: result === "Killed" ? "1px solid #dc2626" : "1px solid var(--border)",
              backgroundColor: result === "Killed" ? "#450a0a" : "transparent",
              color: result === "Killed" ? "#fca5a5" : "var(--text-secondary)",
            }}
          >
            <Skull size={16} /> Killed
          </button>
        </div>

        {/* Performance */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
          <div>
            <label style={labelStyle}>Spend</label>
            <input style={inputStyle} type="number" value={spend} onChange={(e) => setSpend(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>Purchases</label>
            <input style={inputStyle} type="number" value={purchases} onChange={(e) => setPurchases(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>CVR (%)</label>
            <input style={inputStyle} type="number" value={cvr} onChange={(e) => setCvr(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label style={labelStyle}>CPA (auto)</label>
            <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: cpa != null ? "var(--text)" : "var(--text-muted)" }}>
              {cpa != null ? cpa.toFixed(2) : "—"}
            </div>
          </div>
        </div>

        {/* Learning (required) */}
        <div style={{ marginBottom: "18px" }}>
          <label style={labelStyle}>What worked / what didn’t — required</label>
          <textarea
            style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }}
            value={learning}
            onChange={(e) => setLearning(e.target.value)}
            placeholder="One sentence on why this won or lost…"
          />
        </div>

        {error && (
          <div style={{ fontSize: "13px", color: "#fca5a5", backgroundColor: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "6px", padding: "8px 10px", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button onClick={onClose} style={{ padding: "9px 14px", backgroundColor: "transparent", border: "1px solid var(--border)", borderRadius: "7px", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!valid || saving}
            style={{
              padding: "9px 16px", borderRadius: "7px", border: "none", fontFamily: "inherit", fontSize: "14px", fontWeight: 500,
              backgroundColor: valid ? "var(--accent)" : "var(--raised)",
              color: valid ? "#0d0d0f" : "var(--text-muted)",
              cursor: valid && !saving ? "pointer" : "default",
            }}
          >
            {saving ? "Closing…" : "Confirm & close"}
          </button>
        </div>
      </div>
    </div>
  );
}
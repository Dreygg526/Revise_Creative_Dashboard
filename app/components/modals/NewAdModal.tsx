"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useSettings } from "@/app/hooks/useSettings";

interface NewAdModalProps {
  defaultDtc: number; // pre-filled next DTC number
  onClose: () => void;
  onCreate: (fields: {
    dtc_number: number | null;
    ad_name: string;
    product: string | null;
    assigned_editor: string | null;
    assigned_strategist: string | null;
    persona: string | null;
    priority: string | null;
    created_by: string | null;
  }) => Promise<void>;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", backgroundColor: "var(--nested)",
  border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)",
  fontSize: "14px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px",
};

export default function NewAdModal({ defaultDtc, onClose, onCreate }: NewAdModalProps) {
  const { valuesFor, strategistOptions, editorOptions } = useSettings();

  const [dtcNumber, setDtcNumber] = useState(String(defaultDtc));
  const [adName, setAdName] = useState("");
  const [product, setProduct] = useState("");
  const [editor, setEditor] = useState("");
  const [strategist, setStrategist] = useState("");
  const [persona, setPersona] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [saving, setSaving] = useState(false);

  const editors = editorOptions;
  const strategists = strategistOptions;
  const personas = valuesFor("persona");
  const priorities = valuesFor("priority");

  async function handleSave() {
    if (!adName.trim()) return;
    setSaving(true);
    await onCreate({
      dtc_number: dtcNumber ? Number(dtcNumber) : null,
      ad_name: adName.trim(),
      product: product.trim() || null,
      assigned_editor: editor || null,
      assigned_strategist: strategist || null,
      persona: persona || null,
      priority: priority || null,
      created_by: null,
    });
    setSaving(false);
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "440px", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "17px", fontWeight: 600, margin: 0 }}>New ad</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ width: "100px" }}>
              <label style={labelStyle}>DTC #</label>
              <input style={inputStyle} value={dtcNumber} onChange={(e) => setDtcNumber(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Ad name</label>
              <input style={inputStyle} value={adName} onChange={(e) => setAdName(e.target.value)} placeholder="Required" autoFocus />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Product</label>
            <input style={inputStyle} value={product} onChange={(e) => setProduct(e.target.value)} />
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Strategist</label>
              <select style={inputStyle} value={strategist} onChange={(e) => setStrategist(e.target.value)}>
                <option value="">—</option>
                {strategists.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Editor</label>
              <select style={inputStyle} value={editor} onChange={(e) => setEditor(e.target.value)}>
                <option value="">—</option>
                {editors.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Persona</label>
            <select style={inputStyle} value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="">—</option>
              {personas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Priority</label>
            <select style={inputStyle} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "24px" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", backgroundColor: "transparent", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button onClick={handleSave} disabled={!adName.trim() || saving} style={{ padding: "8px 14px", backgroundColor: adName.trim() ? "var(--accent)" : "var(--raised)", border: "none", borderRadius: "6px", color: adName.trim() ? "#0d0d0f" : "var(--text-muted)", fontSize: "14px", fontWeight: 500, cursor: adName.trim() && !saving ? "pointer" : "default", fontFamily: "inherit" }}>
            {saving ? "Saving…" : "Create ad"}
          </button>
        </div>
      </div>
    </div>
  );
}
"use client";

import { useState } from "react";
import { Lightbulb, Plus, Trash2, ArrowRight, X } from "lucide-react";
import { useIdeas } from "@/app/hooks/useIdeas";
import { supabase } from "@/lib/supabaseClient";
import { useAds } from "@/app/hooks/useAds";
import { useSettings } from "@/app/hooks/useSettings";
import { useMyRole } from "@/app/hooks/useMyRole";
import { can } from "@/app/lib/permissions";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", backgroundColor: "var(--nested)",
  border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)",
  fontSize: "14px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px",
};

export default function IdeasView() {
  const { ideas, loading, error, addIdea, deleteIdea, markConverted } = useIdeas();
  const { createAd, updateAd } = useAds();
  const myRole = useMyRole();
  const canManage = can(myRole, "create_ad"); // Founder + Strategist
  const [showNew, setShowNew] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const open = ideas.filter((i) => i.status !== "converted");
  const converted = ideas.filter((i) => i.status === "converted");

  async function convert(ideaId: string, title: string, persona: string | null, angle: string | null, note: string | null) {
    // Guard: ignore if this idea is already being converted (double-click safety).
    if (convertingId) return;
    setConvertingId(ideaId);
    try {
      // Get a fresh DTC number straight from the DB to avoid duplicates.
      const { data: maxRow } = await supabase
        .from("ads")
        .select("dtc_number")
        .order("dtc_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextDtc = (maxRow?.dtc_number ?? 0) + 1;

      const ad = await createAd({
        dtc_number: nextDtc,
        ad_name: title,
        product: null,
        assigned_editor: null,
        assigned_strategist: null,
        persona: persona,
        priority: "Medium",
        created_by: null,
      });
      if (ad) {
        await updateAd(ad.id, { angle, concept: title, notes: note });
      }
      await markConverted(ideaId, ad?.id ?? null);
    } finally {
      setConvertingId(null);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Ideas</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
            Concept backlog. Capture ideas, then convert the good ones into ads.
          </p>
        </div>
        {canManage && (
          <button onClick={() => setShowNew(true)} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", backgroundColor: "var(--accent)", border: "none", borderRadius: "6px", color: "#0d0d0f", fontSize: "14px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
            <Plus size={16} /> New idea
          </button>
        )}
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}
      {error && (
        <div style={{ backgroundColor: "#450a0a", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px" }}>
          Couldn’t load ideas: {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px", marginBottom: "32px" }}>
            {open.map((idea) => (
              <div key={idea.id} style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderLeft: "3px solid #eab308", borderRadius: "10px", padding: "14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", marginBottom: "8px" }}>
                  <Lightbulb size={15} style={{ color: "#eab308", flexShrink: 0, marginTop: "2px" }} />
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>{idea.title}</span>
                </div>
                {(idea.persona || idea.angle) && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                    {idea.persona && <span style={{ fontSize: "11px", color: "var(--text-secondary)", backgroundColor: "var(--raised)", borderRadius: "4px", padding: "2px 8px" }}>{idea.persona}</span>}
                    {idea.angle && <span style={{ fontSize: "11px", color: "var(--text-secondary)", backgroundColor: "var(--raised)", borderRadius: "4px", padding: "2px 8px" }}>{idea.angle}</span>}
                  </div>
                )}
                {idea.note && <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 12px 0" }}>{idea.note}</p>}

                {canManage && (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => convert(idea.id, idea.title, idea.persona, idea.angle, idea.note)} disabled={convertingId !== null} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "6px", backgroundColor: "var(--raised)", border: "1px solid var(--border)", borderRadius: "6px", color: convertingId === idea.id ? "var(--text-muted)" : "var(--text)", fontSize: "12px", cursor: convertingId !== null ? "default" : "pointer", fontFamily: "inherit" }}>
                      <ArrowRight size={13} /> {convertingId === idea.id ? "Converting…" : "Convert to ad"}
                    </button>
                    <button onClick={() => deleteIdea(idea.id)} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "6px", color: "#fca5a5", cursor: "pointer", padding: "6px", display: "flex" }} aria-label="Delete idea">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            ))}

            {open.length === 0 && (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px", border: "1px dashed var(--border)", borderRadius: "10px", gridColumn: "1 / -1" }}>
                No ideas yet. Capture your first concept.
              </div>
            )}
          </div>

          {converted.length > 0 && (
            <div>
              <h2 style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "10px" }}>Converted</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {converted.map((idea) => (
                  <div key={idea.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", opacity: 0.7 }}>
                    <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{idea.title}</span>
                    <span style={{ fontSize: "10px", fontWeight: 600, color: "#4ade80", backgroundColor: "#052e16", padding: "2px 8px", borderRadius: "10px" }}>Converted</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showNew && <NewIdeaModal onClose={() => setShowNew(false)} onAdd={addIdea} />}
    </div>
  );
}

function NewIdeaModal({ onClose, onAdd }: { onClose: () => void; onAdd: (f: { title: string; persona: string | null; angle: string | null; note: string | null }) => Promise<unknown> }) {
  const { valuesFor } = useSettings();
  const [title, setTitle] = useState("");
  const [persona, setPersona] = useState("");
  const [angle, setAngle] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const personas = valuesFor("persona");
  const angles = valuesFor("angle");

  async function handleAdd() {
    if (!title.trim()) return;
    setSaving(true);
    await onAdd({ title: title.trim(), persona: persona || null, angle: angle || null, note: note.trim() || null });
    setSaving(false);
    onClose();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "420px", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>New idea</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex" }}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={labelStyle}>Concept / title</label>
            <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The idea in a few words" autoFocus />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={labelStyle}>Persona</label>
              <select style={inputStyle} value={persona} onChange={(e) => setPersona(e.target.value)}>
                <option value="">—</option>
                {personas.map((p, i) => <option key={i} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Angle</label>
              <select style={inputStyle} value={angle} onChange={(e) => setAngle(e.target.value)}>
                <option value="">—</option>
                {angles.map((a, i) => <option key={i} value={a}>{a}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Note</label>
            <textarea style={{ ...inputStyle, minHeight: "70px", resize: "vertical" }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the idea…" />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "22px" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", backgroundColor: "transparent", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
          <button onClick={handleAdd} disabled={!title.trim() || saving} style={{ padding: "8px 14px", backgroundColor: title.trim() ? "var(--accent)" : "var(--raised)", border: "none", borderRadius: "6px", color: title.trim() ? "#0d0d0f" : "var(--text-muted)", fontSize: "14px", fontWeight: 500, cursor: title.trim() && !saving ? "pointer" : "default", fontFamily: "inherit" }}>
            {saving ? "Saving…" : "Add idea"}
          </button>
        </div>
      </div>
    </div>
  );
}
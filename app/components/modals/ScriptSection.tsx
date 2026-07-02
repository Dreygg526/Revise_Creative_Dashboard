"use client";

import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useScript } from "@/app/hooks/useScript";

interface Props {
  adId: string;
  scriptHook: string | null;
  onHookChange: (v: string) => void;
  canEdit: boolean;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", backgroundColor: "var(--nested)",
  border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)",
  fontSize: "13px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  resize: "vertical",
};
const miniLabel: React.CSSProperties = {
  fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.05em", marginBottom: "4px", display: "block",
};

export default function ScriptSection({ adId, scriptHook, onHookChange, canEdit }: Props) {
  const { scenes, loading, addScene, updateScene, deleteScene, moveScene } = useScript(adId);

  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>
        Script
      </div>

      {/* Hook line */}
      <div style={{ marginBottom: "12px" }}>
        <label style={miniLabel}>Hook (first 3 seconds)</label>
        <textarea
          value={scriptHook ?? ""}
          onChange={(e) => onHookChange(e.target.value)}
          disabled={!canEdit}
          placeholder={canEdit ? "The opening line that stops the scroll…" : "No hook written"}
          style={{ ...inputStyle, minHeight: "44px", opacity: canEdit ? 1 : 0.7 }}
        />
      </div>

      {/* Scenes */}
      {loading ? (
        <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Loading scenes…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {scenes.map((scene, i) => (
            <div key={scene.id} style={{ backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>Scene {i + 1}</span>
                {canEdit && (
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button onClick={() => moveScene(scene.id, -1)} disabled={i === 0} style={iconBtn(i === 0)} aria-label="Move up"><ChevronUp size={13} /></button>
                    <button onClick={() => moveScene(scene.id, 1)} disabled={i === scenes.length - 1} style={iconBtn(i === scenes.length - 1)} aria-label="Move down"><ChevronDown size={13} /></button>
                    <button onClick={() => deleteScene(scene.id)} style={{ ...iconBtn(false), color: "#fca5a5" }} aria-label="Delete scene"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <label style={miniLabel}>Spoken line</label>
                  <textarea
                    value={scene.spoken_line ?? ""}
                    onChange={(e) => updateScene(scene.id, { spoken_line: e.target.value })}
                    disabled={!canEdit}
                    placeholder="Voiceover / what's said"
                    style={{ ...inputStyle, minHeight: "60px", opacity: canEdit ? 1 : 0.7 }}
                  />
                </div>
                <div>
                  <label style={miniLabel}>Visual direction</label>
                  <textarea
                    value={scene.visual_direction ?? ""}
                    onChange={(e) => updateScene(scene.id, { visual_direction: e.target.value })}
                    disabled={!canEdit}
                    placeholder="What's on screen"
                    style={{ ...inputStyle, minHeight: "60px", opacity: canEdit ? 1 : 0.7 }}
                  />
                </div>
              </div>
            </div>
          ))}

          {scenes.length === 0 && (
            <p style={{ fontSize: "13px", color: "var(--text-muted)", padding: "8px 0" }}>
              {canEdit ? "No scenes yet. Add the first scene." : "No script written yet."}
            </p>
          )}

          {canEdit && (
            <button onClick={addScene} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "8px", backgroundColor: "var(--raised)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}>
              <Plus size={14} /> Add scene
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "none", border: "1px solid var(--border)", borderRadius: "5px",
    color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    cursor: disabled ? "default" : "pointer", padding: "3px", display: "flex",
    opacity: disabled ? 0.4 : 1,
  };
}
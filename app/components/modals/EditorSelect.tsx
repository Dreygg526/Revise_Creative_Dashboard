"use client";

import { useMemo } from "react";
import { editorLoads, loadFor, loadColor } from "@/app/lib/editorLoad";
import type { Ad, TeamMember } from "@/app/types";

interface EditorSelectProps {
  value: string;
  onChange: (name: string) => void;
  editors: TeamMember[];
  ads: Ad[];
  style: React.CSSProperties;
}

// The editor dropdown, with each editor's current task count beside their
// name and a breakdown of the chosen editor's plate underneath.
export default function EditorSelect({ value, onChange, editors, ads, style }: EditorSelectProps) {
  const loads = useMemo(() => editorLoads(ads), [ads]);
  const chosen = value ? loadFor(loads, value) : null;

  return (
    <>
      <select style={style} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {editors.map((m) => {
          const n = loadFor(loads, m.name).total;
          return (
            <option key={m.id} value={m.name}>
              {m.name} — {n} {n === 1 ? "task" : "tasks"}
            </option>
          );
        })}
      </select>
      {chosen && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", fontSize: "11px", color: "var(--text-muted)" }}>
          <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: loadColor(chosen.total), flexShrink: 0 }} />
          {chosen.total === 0
            ? "Nothing in Brief, In Production or Review — free."
            : chosen.byStage.map((s) => `${s.stage} ${s.count}`).join(" · ")}
        </div>
      )}
    </>
  );
}

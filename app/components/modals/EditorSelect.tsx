"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { editorLoads, loadFor, loadColor, RED_AT, type EditorLoad } from "@/app/lib/editorLoad";
import type { Ad, TeamMember } from "@/app/types";

interface EditorSelectProps {
  value: string;
  onChange: (name: string) => void;
  editors: TeamMember[];
  ads: Ad[];
  style: React.CSSProperties;
}

function loadLabel(n: number): string {
  if (n === 0) return "Free";
  return `${n} ${n === 1 ? "task" : "tasks"}`;
}

// Coloured count pill: green / amber / red by load.
function LoadPill({ n }: { n: number }) {
  const c = loadColor(n);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      fontSize: "11px", fontWeight: 600, lineHeight: 1,
      padding: "4px 8px", borderRadius: "999px",
      color: c, backgroundColor: `${c}1f`, border: `1px solid ${c}40`,
      whiteSpace: "nowrap", flexShrink: 0,
    }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: c }} />
      {loadLabel(n)}
    </span>
  );
}

// Thin bar filling toward the overloaded threshold.
function LoadBar({ n }: { n: number }) {
  return (
    <div style={{ height: "4px", borderRadius: "2px", backgroundColor: "var(--raised)", overflow: "hidden" }}>
      <div style={{
        width: `${Math.min(100, (n / RED_AT) * 100)}%`, height: "100%",
        backgroundColor: loadColor(n), borderRadius: "2px",
        minWidth: n > 0 ? "4px" : 0,
      }} />
    </div>
  );
}

// The editor picker, showing how many active tasks (Brief / In Production /
// Review) each editor already holds. A native <select> can't render
// anything but plain text in its options, hence the custom menu.
export default function EditorSelect({ value, onChange, editors, ads, style }: EditorSelectProps) {
  const loads = useMemo(() => editorLoads(ads), [ads]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chosen = value ? loadFor(loads, value) : null;

  function pick(name: string) {
    onChange(name);
    setOpen(false);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...style,
          display: "flex", alignItems: "center", gap: "8px",
          cursor: "pointer", textAlign: "left",
          borderColor: open ? "var(--text-muted)" : (style.borderColor as string | undefined),
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: value ? "var(--text)" : "var(--text-muted)" }}>
          {value || "—"}
        </span>
        {chosen && <LoadPill n={chosen.total} />}
        <ChevronDown size={15} style={{ color: "var(--text-muted)", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 60,
          backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px",
          boxShadow: "0 12px 32px rgba(0,0,0,0.45)", padding: "6px", minWidth: "240px",
          maxHeight: "320px", overflowY: "auto",
        }}>
          <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", padding: "6px 8px 8px" }}>
            Active tasks · Brief → Review
          </div>

          <MenuRow selected={!value} onClick={() => pick("")}>
            <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>Unassigned</span>
          </MenuRow>

          {editors.map((m) => (
            <EditorRow key={m.id} name={m.name} load={loadFor(loads, m.name)} selected={value === m.name} onClick={() => pick(m.name)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuRow({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%", display: "block", textAlign: "left", cursor: "pointer",
        padding: "8px", borderRadius: "7px", border: "none", fontFamily: "inherit",
        backgroundColor: selected ? "var(--raised)" : hover ? "var(--hover)" : "transparent",
        color: "var(--text)",
      }}
    >
      {children}
    </button>
  );
}

function EditorRow({ name, load, selected, onClick }: { name: string; load: EditorLoad; selected: boolean; onClick: () => void }) {
  return (
    <MenuRow selected={selected} onClick={onClick}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
        <span style={{ width: "14px", display: "flex", flexShrink: 0 }}>
          {selected && <Check size={14} style={{ color: "var(--accent)" }} />}
        </span>
        <span style={{ flex: 1, fontSize: "13px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <LoadPill n={load.total} />
      </div>
      <div style={{ paddingLeft: "22px" }}>
        <LoadBar n={load.total} />
        {load.byStage.length > 0 && (
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
            {load.byStage.map((s) => (
              <span key={s.stage} style={{ fontSize: "10px", color: "var(--text-secondary)", backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "4px", padding: "1px 6px" }}>
                {s.stage} <b style={{ color: "var(--text)", fontWeight: 600 }}>{s.count}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </MenuRow>
  );
}

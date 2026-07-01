"use client";

import { useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { useLists } from "@/app/hooks/useLists";

// Editable vocab lists (stage + priority deliberately excluded).
const LIST_TYPES: { key: string; label: string }[] = [
  { key: "persona", label: "Personas" },
  { key: "sub_avatar", label: "Sub avatars" },
  { key: "angle", label: "Angles" },
  { key: "concept", label: "Concepts" },
  { key: "ad_type", label: "Ad types" },
  { key: "content_source", label: "Content sources" },
  { key: "product", label: "Products" },
  { key: "format", label: "Formats" },
  { key: "core_emotion", label: "Core emotions" },
  { key: "problem", label: "Problems" },
  { key: "awareness", label: "Awareness" },
];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", backgroundColor: "var(--nested)",
  border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)",
  fontSize: "14px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};

export default function ListsManager() {
  const { loading, valuesFor, addValue, renameValue, deleteValue, reorder } = useLists();
  const [activeType, setActiveType] = useState<string>("persona");
  const [newValue, setNewValue] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  const items = valuesFor(activeType);

  async function handleAdd() {
    if (!newValue.trim()) return;
    await addValue(activeType, newValue.trim());
    setNewValue("");
  }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = items.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorder(activeType, ids);
    setDragId(null);
  }

  return (
    <div>
      {/* List type selector */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "20px" }}>
        {LIST_TYPES.map((t) => {
          const active = activeType === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveType(t.key)}
              style={{
                padding: "5px 12px", borderRadius: "6px",
                border: active ? "none" : "1px solid var(--border)",
                backgroundColor: active ? "var(--accent)" : "transparent",
                color: active ? "#0d0d0f" : "var(--text-secondary)",
                fontSize: "13px", fontWeight: active ? 600 : 400,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Add new value */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", maxWidth: "420px" }}>
        <input
          style={inputStyle}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder={`Add a new ${LIST_TYPES.find((t) => t.key === activeType)?.label.toLowerCase().replace(/s$/, "")}…`}
        />
        <button
          onClick={handleAdd}
          disabled={!newValue.trim()}
          style={{
            display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap",
            padding: "8px 14px",
            backgroundColor: newValue.trim() ? "var(--accent)" : "var(--raised)",
            border: "none", borderRadius: "6px",
            color: newValue.trim() ? "#0d0d0f" : "var(--text-muted)",
            fontSize: "14px", fontWeight: 500, cursor: newValue.trim() ? "pointer" : "default", fontFamily: "inherit",
          }}
        >
          <Plus size={15} /> Add
        </button>
      </div>

      {/* The list */}
      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}

      {!loading && (
        <div style={{ maxWidth: "420px", display: "flex", flexDirection: "column", gap: "6px" }}>
          {items.map((item) => (
            <div
              key={item.id}
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(item.id)}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                backgroundColor: dragId === item.id ? "var(--hover)" : "var(--card)",
                border: "1px solid var(--border)", borderRadius: "8px",
                padding: "8px 10px",
              }}
            >
              <span style={{ cursor: "grab", color: "var(--text-muted)", display: "flex" }}>
                <GripVertical size={15} />
              </span>
              <input
                value={item.value}
                onChange={(e) => renameValue(item.id, e.target.value)}
                style={{ ...inputStyle, border: "1px solid transparent", backgroundColor: "transparent", padding: "4px 6px" }}
              />
              <button
                onClick={() => deleteValue(item.id)}
                style={{ background: "none", border: "1px solid var(--border)", borderRadius: "6px", color: "#fca5a5", cursor: "pointer", padding: "6px", display: "flex" }}
                aria-label="Delete value"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}

          {items.length === 0 && (
            <div style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)", fontSize: "13px", border: "1px dashed var(--border)", borderRadius: "8px" }}>
              No values yet. Add one above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
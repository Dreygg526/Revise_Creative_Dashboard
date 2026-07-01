"use client";

import { useState } from "react";
import { Plus, CheckSquare, X, Trash2, Search } from "lucide-react";
import { useAds } from "@/app/hooks/useAds";
import { useMyRole } from "@/app/hooks/useMyRole";
import { can } from "@/app/lib/permissions";
import { useSettings } from "@/app/hooks/useSettings";
import NewAdModal from "@/app/components/modals/NewAdModal";
import AdDetailModal from "@/app/components/modals/AdDetailModal";
import type { Ad } from "@/app/types";

export default function PipelineView() {
  const { ads, loading, error, createAd, updateAd, deleteAd, deleteMany, nextDtcNumber } = useAds();
  const { valuesFor } = useSettings();
  const myRole = useMyRole();
  const canCreate = can(myRole, "create_ad");
  const canBatchDelete = can(myRole, "batch_delete");
  const [showClosed, setShowClosed] = useState(false);
  const [closedSearch, setClosedSearch] = useState("");
  const [closedFilter, setClosedFilter] = useState<"all" | "Winner" | "Killed">("all");

  const [showNewAd, setShowNewAd] = useState(false);
  const [openAd, setOpenAd] = useState<Ad | null>(null);

  // Selection mode state
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingBatch, setConfirmingBatch] = useState(false);

  // Search query (matches name / product / editor / strategist)
  const [query, setQuery] = useState("");

  const stages = valuesFor("stage");

  function matchesQuery(a: Ad): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      a.ad_name,
      a.product,
      a.assigned_editor,
      a.assigned_strategist,
      a.dtc_number != null ? `dtc #${a.dtc_number}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  }

  function adsInStage(stage: string): Ad[] {
    return ads.filter((a) => a.stage === stage && matchesQuery(a));
  }

  const liveOpenAd = openAd ? ads.find((a) => a.id === openAd.id) ?? null : null;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setConfirmingBatch(false);
  }

  function handleCardClick(ad: Ad) {
    if (selectMode) {
      toggleSelect(ad.id);
    } else {
      setOpenAd(ad);
    }
  }

  async function doBatchDelete() {
    await deleteMany(Array.from(selected));
    exitSelectMode();
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Pipeline</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
            Every ad, from idea to winner or killed.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {!selectMode ? (
            <>
              {canBatchDelete && (
                <button
                  onClick={() => setSelectMode(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "8px 14px", backgroundColor: "transparent",
                    border: "1px solid var(--border)", borderRadius: "6px",
                    color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <CheckSquare size={16} /> Select
                </button>
              )}
              {canCreate && (
                <button
                  onClick={() => setShowNewAd(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "8px 14px", backgroundColor: "var(--accent)", border: "none",
                    borderRadius: "6px", color: "#0d0d0f", fontSize: "14px", fontWeight: 500,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <Plus size={16} strokeWidth={2.25} /> New ad
                </button>
              )}
            </>
          ) : (
            <>
              <span style={{ display: "flex", alignItems: "center", color: "var(--text-secondary)", fontSize: "14px", marginRight: "4px" }}>
                {selected.size} selected
              </span>
              <button
                onClick={() => setConfirmingBatch(true)}
                disabled={selected.size === 0}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "8px 14px",
                  backgroundColor: selected.size > 0 ? "#7f1d1d" : "var(--raised)",
                  border: "none", borderRadius: "6px",
                  color: selected.size > 0 ? "#fee2e2" : "var(--text-muted)",
                  fontSize: "14px", fontWeight: 500,
                  cursor: selected.size > 0 ? "pointer" : "default", fontFamily: "inherit",
                }}
              >
                <Trash2 size={16} /> Delete selected
              </button>
              <button
                onClick={exitSelectMode}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "8px 14px", backgroundColor: "transparent",
                  border: "1px solid var(--border)", borderRadius: "6px",
                  color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                <X size={16} /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: "20px", maxWidth: "420px" }}>
        <div style={{ position: "relative" }}>
          <Search
            size={15}
            style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, product, editor, strategist…"
            style={{
              width: "100%", padding: "8px 12px 8px 34px",
              backgroundColor: "var(--nested)", border: "1px solid var(--border)",
              borderRadius: "8px", color: "var(--text)", fontSize: "13px",
              fontFamily: "inherit", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading board…</p>}
      {error && (
        <div style={{ backgroundColor: "#450a0a", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px" }}>
          Couldn’t load ads: {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ display: "flex", gap: "10px", paddingBottom: "8px", width: "100%" }}>
          {stages.map((stage) => {
            const stageAds = adsInStage(stage);
            return (
              <div
                key={stage}
                style={{
                  flex: "1 1 0", minWidth: 0,
                  backgroundColor: "var(--nested)", border: "1px solid var(--border-soft)",
                  borderRadius: "10px", padding: "10px", display: "flex",
                  flexDirection: "column", gap: "8px",
                  height: "75vh",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 4px 6px 4px", flexShrink: 0 }}>
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text)" }}>{stage}</span>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", backgroundColor: "var(--raised)", borderRadius: "10px", padding: "1px 8px", minWidth: "20px", textAlign: "center" }}>
                    {stageAds.length}
                  </span>
                </div>

                {/* Scrollable card area */}
                <div className="column-scroll" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px", paddingRight: "2px" }}>

                {stage === "Winner / Killed" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "center", padding: "12px 4px" }}>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center" }}>
                      {stageAds.length} closed {stageAds.length === 1 ? "ad" : "ads"}
                    </div>
                    <button
                      onClick={() => setShowClosed(true)}
                      style={{
                        width: "100%", padding: "8px", backgroundColor: "var(--raised)",
                        border: "1px solid var(--border)", borderRadius: "6px",
                        color: "var(--text-secondary)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      View closed
                    </button>
                  </div>
                ) : (
                  <>
                    {stageAds.map((ad) => (
                      <AdCard
                        key={ad.id}
                        ad={ad}
                        selectMode={selectMode}
                        selected={selected.has(ad.id)}
                        onClick={() => handleCardClick(ad)}
                      />
                    ))}
                    {stageAds.length === 0 && (
                      <div style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>Empty</div>
                    )}
                  </>
                )}
                </div>{/* end scroll area */}
              </div>
            );
          })}
        </div>
      )}

      {showClosed && (() => {
        const closed = ads.filter((a) => a.stage === "Winner / Killed");
        const q = closedSearch.trim().toLowerCase();
        const filtered = closed
          .filter((a) => closedFilter === "all" ? true : a.result === closedFilter)
          .filter((a) =>
            q === "" ? true :
            (a.ad_name ?? "").toLowerCase().includes(q) ||
            (a.product ?? "").toLowerCase().includes(q) ||
            (a.persona ?? "").toLowerCase().includes(q) ||
            String(a.dtc_number ?? "").includes(q)
          )
          .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));

        return (
          <div onClick={() => setShowClosed(false)} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "640px", maxHeight: "85vh", display: "flex", flexDirection: "column", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>Closed ads <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· {closed.length}</span></h2>
                <button onClick={() => setShowClosed(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex" }}>
                  <X size={18} />
                </button>
              </div>

              {/* Search + filter */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "14px" }}>
                <input
                  value={closedSearch}
                  onChange={(e) => setClosedSearch(e.target.value)}
                  placeholder="Search closed ads…"
                  style={{ flex: 1, padding: "8px 10px", backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)", fontSize: "14px", fontFamily: "inherit", outline: "none" }}
                />
                {(["all", "Winner", "Killed"] as const).map((f) => {
                  const active = closedFilter === f;
                  return (
                    <button key={f} onClick={() => setClosedFilter(f)} style={{ padding: "6px 12px", borderRadius: "6px", border: active ? "none" : "1px solid var(--border)", backgroundColor: active ? "var(--accent)" : "transparent", color: active ? "#0d0d0f" : "var(--text-secondary)", fontSize: "13px", fontWeight: active ? 600 : 400, cursor: "pointer", fontFamily: "inherit" }}>
                      {f === "all" ? "All" : f}
                    </button>
                  );
                })}
              </div>

              {/* List */}
              <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
                {filtered.map((ad) => {
                  const win = ad.result === "Winner";
                  return (
                    <div key={ad.id} onClick={() => { setShowClosed(false); handleCardClick(ad); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderLeft: `3px solid ${win ? "#16a34a" : "#dc2626"}`, borderRadius: "8px", padding: "10px 12px", cursor: "pointer" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", minWidth: "50px" }}>{ad.dtc_number != null ? `DTC #${ad.dtc_number}` : "—"}</span>
                        <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text)" }}>{ad.ad_name || "Untitled"}</span>
                        {ad.persona && <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>· {ad.persona}</span>}
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px", backgroundColor: win ? "#052e16" : "#450a0a", color: win ? "#4ade80" : "#fca5a5" }}>{ad.result}</span>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div style={{ padding: "30px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>No closed ads match.</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

            {showNewAd && (
        <NewAdModal
          defaultDtc={nextDtcNumber()}
          onClose={() => setShowNewAd(false)}
          onCreate={async (fields) => { await createAd(fields); }}
        />
      )}

      {liveOpenAd && !selectMode && (
        <AdDetailModal
          ad={liveOpenAd}
          onClose={() => setOpenAd(null)}
          onSave={async (id, fields) => { await updateAd(id, fields); }}
          onDelete={async (id) => { await deleteAd(id); }}
        />
      )}

      {/* Batch delete confirm */}
      {confirmingBatch && (
        <div
          onClick={() => setConfirmingBatch(false)}
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "20px" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "380px", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 8px 0" }}>
              Delete {selected.size} ad{selected.size === 1 ? "" : "s"}?
            </h2>
            <p style={{ fontSize: "14px", color: "var(--text-secondary)", margin: "0 0 20px 0", lineHeight: 1.4 }}>
              This can’t be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                onClick={() => setConfirmingBatch(false)}
                style={{ padding: "8px 14px", backgroundColor: "transparent", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}
              >
                Cancel
              </button>
              <button
                onClick={doBatchDelete}
                style={{ padding: "8px 14px", backgroundColor: "#7f1d1d", border: "none", borderRadius: "6px", color: "#fee2e2", fontSize: "14px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Map a priority to its accent color (left stripe on the card).
function priorityColor(priority: string | null): string {
  switch (priority) {
    case "High":
      return "#dc2626"; // red
    case "Medium":
      return "#f59e0b"; // amber
    case "Low":
      return "#6b7280"; // gray
    default:
      return "transparent";
  }
}

function AdCard({
  ad, selectMode, selected, onClick,
}: {
  ad: Ad; selectMode: boolean; selected: boolean; onClick: () => void;
}) {
  const isClosed = ad.stage === "Winner / Killed";
  const stripe = priorityColor(ad.priority);

  // Each labeled detail row — only rendered when the value exists.
  function Row({ label, value }: { label: string; value: string | null | undefined }) {
    if (!value) return null;
    return (
      <div style={{ display: "flex", gap: "8px", fontSize: "11px", lineHeight: 1.5 }}>
        <span style={{ color: "var(--text-muted)", width: "62px", flexShrink: 0 }}>{label}</span>
        <span style={{ color: "var(--text-secondary)" }}>{value}</span>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        backgroundColor: "var(--card)",
        border: selected ? "1px solid #fca5a5" : "1px solid var(--border)",
        borderLeft: selected
          ? "1px solid #fca5a5"
          : `3px solid ${stripe === "transparent" ? "var(--border)" : stripe}`,
        borderRadius: "8px", padding: "10px 12px", cursor: "pointer",
        display: "flex", flexDirection: "column", gap: "8px",
        outline: selected ? "1px solid #fca5a5" : "none",
      }}
    >
      {selectMode && (
        <div
          style={{
            position: "absolute", top: "8px", right: "8px",
            width: "16px", height: "16px", borderRadius: "4px",
            border: selected ? "none" : "1px solid var(--text-muted)",
            backgroundColor: selected ? "#dc2626" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {selected && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      )}

      {/* Top row: DTC # + result tag */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingRight: selectMode ? "22px" : 0 }}>
        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 500 }}>
          {ad.dtc_number != null ? `DTC #${ad.dtc_number}` : "—"}
        </span>
        {isClosed && ad.result && !selectMode && (
          <span style={{
            fontSize: "10px", fontWeight: 600, padding: "1px 7px", borderRadius: "10px",
            backgroundColor: ad.result === "Winner" ? "#052e16" : "#450a0a",
            color: ad.result === "Winner" ? "#4ade80" : "#fca5a5",
          }}>{ad.result}</span>
        )}
      </div>

      {/* Ad name — the title */}
      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", lineHeight: 1.35 }}>
        {ad.ad_name || "Untitled"}
      </div>

      {/* Labeled details (only filled ones show) */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <Row label="Product" value={ad.product} />
        <Row label="Format" value={ad.format} />
        <Row label="Strategist" value={ad.assigned_strategist} />
        <Row label="Editor" value={ad.assigned_editor} />
        <Row label="Persona" value={ad.persona} />
      </div>
    </div>
  );
}
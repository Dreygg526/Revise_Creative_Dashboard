"use client";

import { useState, useMemo } from "react";
import { useAds } from "@/app/hooks/useAds";
import AdDetailModal from "@/app/components/modals/AdDetailModal";
import { calcCpa } from "@/app/types";
import type { Ad } from "@/app/types";

type Filter = "all" | "Winner" | "Killed";

export default function LearningsView() {
  const { ads, loading, error, updateAd, deleteAd } = useAds();
  const [filter, setFilter] = useState<Filter>("all");
  const [openAd, setOpenAd] = useState<Ad | null>(null);

  // Keep the open ad in sync with the latest data after a save.
  const liveOpenAd = openAd ? ads.find((a) => a.id === openAd.id) ?? null : null;

  // Derived: closed ads that have a learning written.
  const learnings = useMemo(() => {
    return ads
      .filter((a) => a.result && a.learning && a.learning.trim())
      .filter((a) => (filter === "all" ? true : a.result === filter))
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }, [ads, filter]);

  const winnerCount = ads.filter((a) => a.result === "Winner" && a.learning?.trim()).length;
  const killedCount = ads.filter((a) => a.result === "Killed" && a.learning?.trim()).length;

  const FILTERS: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: winnerCount + killedCount },
    { key: "Winner", label: "Winners", count: winnerCount },
    { key: "Killed", label: "Killed", count: killedCount },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
          Learnings
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
          Captured automatically every time an ad is closed.
        </p>
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "5px 12px", borderRadius: "6px",
                border: active ? "none" : "1px solid var(--border)",
                backgroundColor: active ? "var(--accent)" : "transparent",
                color: active ? "#0d0d0f" : "var(--text-secondary)",
                fontSize: "13px", fontWeight: active ? 600 : 400,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {f.label}
              <span style={{ color: active ? "#0d0d0f" : "var(--text-muted)", fontSize: "12px" }}>
                {f.count}
              </span>
            </button>
          );
        })}
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}
      {error && (
        <div style={{ backgroundColor: "#450a0a", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px" }}>
          Couldn’t load learnings: {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {learnings.map((ad) => (
            <LearningCard key={ad.id} ad={ad} onClick={() => setOpenAd(ad)} />
          ))}

          {learnings.length === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px", border: "1px dashed var(--border)", borderRadius: "10px" }}>
              No learnings yet. They appear here automatically when ads are marked Winner or Killed with a learning.
            </div>
          )}
        </div>
      )}

      {liveOpenAd && (
        <AdDetailModal
          ad={liveOpenAd}
          onClose={() => setOpenAd(null)}
          onSave={async (id, fields) => { await updateAd(id, fields); }}
          onDelete={async (id) => { await deleteAd(id); setOpenAd(null); }}
        />
      )}
    </div>
  );
}

function LearningCard({ ad, onClick }: { ad: Ad; onClick: () => void }) {
  const isWinner = ad.result === "Winner";
  const cpa = calcCpa(ad);

  // Small context chips (only those that exist)
  const chips: string[] = [];
  if (ad.persona) chips.push(ad.persona);
  if (ad.ad_type) chips.push(ad.ad_type);
  if (cpa != null) chips.push(`CPA ${cpa.toFixed(2)}`);

  return (
    <div
      onClick={onClick}
      style={{
        backgroundColor: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${isWinner ? "#16a34a" : "#dc2626"}`,
        borderRadius: "8px",
        padding: "14px 16px",
        cursor: "pointer",
      }}
    >
      {/* Top: source + result */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {ad.dtc_number != null ? `DTC #${ad.dtc_number} · ` : ""}{ad.ad_name || "Untitled"}
        </span>
        <span
          style={{
            fontSize: "10px", fontWeight: 600, padding: "1px 8px", borderRadius: "10px",
            backgroundColor: isWinner ? "#052e16" : "#450a0a",
            color: isWinner ? "#4ade80" : "#fca5a5",
          }}
        >
          {ad.result}
        </span>
      </div>

      {/* The learning */}
      <div style={{ fontSize: "14px", color: "var(--text)", lineHeight: 1.5 }}>
        {ad.learning}
      </div>

      {/* Context chips */}
      {chips.length > 0 && (
        <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
          {chips.map((c, i) => (
            <span
              key={i}
              style={{
                fontSize: "11px", color: "var(--text-secondary)",
                backgroundColor: "var(--raised)", borderRadius: "4px", padding: "2px 8px",
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
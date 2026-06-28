"use client";

import { useState, useMemo } from "react";
import { useAds } from "@/app/hooks/useAds";
import { useTargets } from "@/app/hooks/useTargets";
import type { Ad } from "@/app/types";

// The dimensions you can group by. `key` is the Ad field, `label` is shown.
const GROUP_OPTIONS = [
  { key: "persona", label: "Persona" },
  { key: "core_emotion", label: "Core Emotion" },
  { key: "problem", label: "Problem" },
  { key: "awareness", label: "Awareness" },
  { key: "ad_type", label: "Ad Type" },
  { key: "concept", label: "Concept" },
] as const;

type GroupKey = (typeof GROUP_OPTIONS)[number]["key"];

interface GroupRow {
  label: string;
  count: number;
  spend: number;
  purchases: number;
  avgCvr: number | null;
  cpa: number | null;
  closed: number;
  winners: number;
  winRate: number | null;
}

export default function AnalyticsView() {
  const { ads, loading, error } = useAds();
  const { targetCpa, targetHitRate } = useTargets();
  const [groupBy, setGroupBy] = useState<GroupKey>("persona");

  // Build aggregated rows grouped by the chosen dimension.
  const rows = useMemo<GroupRow[]>(() => {
    const map = new Map<string, Ad[]>();
    for (const ad of ads) {
      const raw = ad[groupBy];
      const key = raw && String(raw).trim() ? String(raw) : "— Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ad);
    }

    const result: GroupRow[] = [];
    for (const [label, groupAds] of map.entries()) {
      let spend = 0;
      let purchases = 0;
      let cvrSum = 0;
      let cvrCount = 0;
      let closed = 0;
      let winners = 0;

      for (const ad of groupAds) {
        if (ad.spend != null) spend += ad.spend;
        if (ad.purchases != null) purchases += ad.purchases;
        if (ad.cvr != null) { cvrSum += ad.cvr; cvrCount++; }
        if (ad.result) {
          closed++;
          if (ad.result === "Winner") winners++;
        }
      }

      result.push({
        label,
        count: groupAds.length,
        spend,
        purchases,
        avgCvr: cvrCount > 0 ? cvrSum / cvrCount : null,
        cpa: purchases > 0 ? spend / purchases : null,
        closed,
        winners,
        winRate: closed > 0 ? (winners / closed) * 100 : null,
      });
    }

    // Sort by count, biggest groups first.
    result.sort((a, b) => b.count - a.count);
    return result;
  }, [ads, groupBy]);

  // Totals row
  const totals = useMemo(() => {
    let spend = 0, purchases = 0, closed = 0, winners = 0, count = 0;
    let cvrSum = 0, cvrCount = 0;
    for (const ad of ads) {
      count++;
      if (ad.spend != null) spend += ad.spend;
      if (ad.purchases != null) purchases += ad.purchases;
      if (ad.cvr != null) { cvrSum += ad.cvr; cvrCount++; }
      if (ad.result) { closed++; if (ad.result === "Winner") winners++; }
    }
    return {
      count, spend, purchases,
      avgCvr: cvrCount > 0 ? cvrSum / cvrCount : null,
      cpa: purchases > 0 ? spend / purchases : null,
      winRate: closed > 0 ? (winners / closed) * 100 : null,
    };
  }, [ads]);

  // Color helpers vs targets
  function cpaColor(cpa: number | null): string {
    if (cpa == null || targetCpa == null) return "var(--text-secondary)";
    return cpa <= targetCpa ? "#4ade80" : "#fca5a5";
  }
  function hitColor(rate: number | null): string {
    if (rate == null || targetHitRate == null) return "var(--text-secondary)";
    return rate >= targetHitRate ? "#4ade80" : "#fca5a5";
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
          Analytics
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
          Performance sliced by strategy. Fills in automatically as ads run and close.
        </p>
      </div>

      {/* Group-by switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Group by</span>
        {GROUP_OPTIONS.map((opt) => {
          const active = groupBy === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setGroupBy(opt.key)}
              style={{
                padding: "5px 12px", borderRadius: "6px",
                border: active ? "none" : "1px solid var(--border)",
                backgroundColor: active ? "var(--accent)" : "transparent",
                color: active ? "#0d0d0f" : "var(--text-secondary)",
                fontSize: "13px", fontWeight: active ? 600 : 400,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}
      {error && (
        <div style={{ backgroundColor: "#450a0a", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px" }}>
          Couldn’t load analytics: {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ backgroundColor: "var(--nested)", textAlign: "left" }}>
                <Th>{GROUP_OPTIONS.find((g) => g.key === groupBy)?.label}</Th>
                <Th right>Ads</Th>
                <Th right>Spend</Th>
                <Th right>Purchases</Th>
                <Th right>Avg CVR</Th>
                <Th right>CPA</Th>
                <Th right>Win rate</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td>{r.label}</Td>
                  <Td right muted>{r.count}</Td>
                  <Td right>{r.spend > 0 ? fmt(r.spend) : "—"}</Td>
                  <Td right>{r.purchases > 0 ? fmt(r.purchases) : "—"}</Td>
                  <Td right>{r.avgCvr != null ? fmt(r.avgCvr) + "%" : "—"}</Td>
                  <Td right color={cpaColor(r.cpa)}>{r.cpa != null ? fmt(r.cpa) : "—"}</Td>
                  <Td right color={hitColor(r.winRate)}>{r.winRate != null ? fmt(r.winRate) + "%" : "—"}</Td>
                </tr>
              ))}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
                    No ads yet.
                  </td>
                </tr>
              )}
            </tbody>

            {rows.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)", backgroundColor: "var(--nested)" }}>
                  <Td><strong>All ads</strong></Td>
                  <Td right muted>{totals.count}</Td>
                  <Td right>{totals.spend > 0 ? fmt(totals.spend) : "—"}</Td>
                  <Td right>{totals.purchases > 0 ? fmt(totals.purchases) : "—"}</Td>
                  <Td right>{totals.avgCvr != null ? fmt(totals.avgCvr) + "%" : "—"}</Td>
                  <Td right color={cpaColor(totals.cpa)}>{totals.cpa != null ? fmt(totals.cpa) : "—"}</Td>
                  <Td right color={hitColor(totals.winRate)}>{totals.winRate != null ? fmt(totals.winRate) + "%" : "—"}</Td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Target legend */}
      <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--text-muted)" }}>
        Targets — CPA ≤ {targetCpa ?? "—"} and win rate ≥ {targetHitRate ?? "—"}% show green. Editable in Settings.
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{ padding: "10px 14px", fontWeight: 500, color: "var(--text-secondary)", textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function Td({ children, right, muted, color }: { children: React.ReactNode; right?: boolean; muted?: boolean; color?: string }) {
  return (
    <td style={{ padding: "10px 14px", textAlign: right ? "right" : "left", color: color ?? (muted ? "var(--text-muted)" : "var(--text)"), whiteSpace: "nowrap" }}>
      {children}
    </td>
  );
}
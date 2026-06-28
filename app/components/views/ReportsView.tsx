"use client";

import { useState, useMemo } from "react";
import { useAds } from "@/app/hooks/useAds";
import type { Ad } from "@/app/types";

// Which person field to attribute an ad to, per role.
const ROLE_OPTIONS = [
  { key: "assigned_strategist", label: "Strategist" },
  { key: "assigned_editor", label: "Editor" },
  { key: "assigned_media_buyer", label: "Media Buyer" },
  { key: "assigned_designer", label: "Graphic Designer" },
] as const;

type RoleKey = (typeof ROLE_OPTIONS)[number]["key"];

interface PersonRow {
  name: string;
  ads: number;
  closed: number;
  winners: number;
  winRate: number | null;
  spend: number;
  winnerShare: number; // % of all winners (the contribution metric)
}

export default function ReportsView() {
  const { ads, loading, error } = useAds();
  const [roleKey, setRoleKey] = useState<RoleKey>("assigned_strategist");

  const rows = useMemo<PersonRow[]>(() => {
    // Group ads by the chosen person field.
    const map = new Map<string, Ad[]>();
    for (const ad of ads) {
      const raw = ad[roleKey as keyof Ad];
      const name = raw && String(raw).trim() ? String(raw) : "— Unassigned";
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(ad);
    }

    // Total winners across everyone (for share %).
    const totalWinners = ads.filter((a) => a.result === "Winner").length;

    const result: PersonRow[] = [];
    for (const [name, personAds] of map.entries()) {
      let closed = 0, winners = 0, spend = 0;
      for (const ad of personAds) {
        if (ad.spend != null) spend += ad.spend;
        if (ad.result) {
          closed++;
          if (ad.result === "Winner") winners++;
        }
      }
      result.push({
        name,
        ads: personAds.length,
        closed,
        winners,
        winRate: closed > 0 ? (winners / closed) * 100 : null,
        spend,
        winnerShare: totalWinners > 0 ? (winners / totalWinners) * 100 : 0,
      });
    }

    // Sort by winners desc, then ad count.
    result.sort((a, b) => b.winners - a.winners || b.ads - a.ads);
    return result;
  }, [ads, roleKey]);

  const maxWinners = Math.max(1, ...rows.map((r) => r.winners));
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
          Reports
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
          Team contribution and hit rate. Who’s producing the winners.
        </p>
      </div>

      {/* Role toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "24px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>By</span>
        {ROLE_OPTIONS.map((opt) => {
          const active = roleKey === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setRoleKey(opt.key)}
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
          Couldn’t load reports: {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Column header */}
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 90px 90px 90px", gap: "16px", padding: "0 16px", fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            <div>Name</div>
            <div>Winner share</div>
            <div style={{ textAlign: "right" }}>Win rate</div>
            <div style={{ textAlign: "right" }}>Ads</div>
            <div style={{ textAlign: "right" }}>Spend</div>
          </div>

          {rows.map((r) => {
            // Bar width is relative to the top performer's winners.
            const barPct = (r.winners / maxWinners) * 100;
            return (
              <div
                key={r.name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "160px 1fr 90px 90px 90px",
                  gap: "16px",
                  alignItems: "center",
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "14px 16px",
                }}
              >
                {/* Name */}
                <div style={{ fontSize: "13px", fontWeight: 500, color: "var(--text)" }}>{r.name}</div>

                {/* Rainbow contribution bar */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1, height: "10px", backgroundColor: "var(--nested)", borderRadius: "6px", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${barPct}%`,
                        height: "100%",
                        borderRadius: "6px",
                        background: "linear-gradient(90deg, #6366f1, #06b6d4, #22c55e, #eab308, #f97316, #ef4444)",
                        minWidth: r.winners > 0 ? "8px" : "0",
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)", width: "44px", textAlign: "right" }}>
                    {fmt(r.winnerShare)}%
                  </span>
                </div>

                {/* Win rate */}
                <div style={{ textAlign: "right", fontSize: "13px", color: r.winRate != null ? "var(--text)" : "var(--text-muted)" }}>
                  {r.winRate != null ? fmt(r.winRate) + "%" : "—"}
                </div>

                {/* Ads */}
                <div style={{ textAlign: "right", fontSize: "13px", color: "var(--text-secondary)" }}>{r.ads}</div>

                {/* Spend */}
                <div style={{ textAlign: "right", fontSize: "13px", color: "var(--text-secondary)" }}>
                  {r.spend > 0 ? fmt(r.spend) : "—"}
                </div>
              </div>
            );
          })}

          {rows.length === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px", border: "1px dashed var(--border)", borderRadius: "10px" }}>
              No data yet.
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--text-muted)" }}>
        Winner share = each person’s portion of all winning ads. Bar length is relative to the top performer.
      </div>
    </div>
  );
}
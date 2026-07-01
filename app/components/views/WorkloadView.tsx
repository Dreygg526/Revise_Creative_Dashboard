"use client";

import { useMemo } from "react";
import { useAds } from "@/app/hooks/useAds";
import { useSettings } from "@/app/hooks/useSettings";
import { roleBadgeStyle } from "@/app/lib/roleStyles";
import type { Ad, TeamMember } from "@/app/types";

const CLOSED_STAGE = "Winner / Killed";

// Capacity model: how many active ads counts as a "full plate".
// Bar fills toward this; color shifts as load rises.
const FULL_CAPACITY = 5;        // amber zone starts above this-ish
const AMBER_AT = 4;             // 4-5 active = getting full
const RED_AT = 6;               // 6+ active = overloaded

function loadColor(n: number): string {
  if (n >= RED_AT) return "#ef4444";        // red — overloaded
  if (n >= AMBER_AT) return "#eab308";       // amber — getting full
  return "#22c55e";                          // green — healthy
}

// Which ad field holds the assignment for a given role.
function fieldForRole(role: string): keyof Ad | null {
  if (role === "Strategist") return "assigned_strategist";
  if (role === "Editor" || role === "Graphic Designer") return "assigned_editor";
  if (role === "Media Buyer") return "assigned_media_buyer";
  if (role === "Founder") return "assigned_strategist"; // founders often act as strategists
  return null;
}

interface Row {
  member: TeamMember;
  active: Ad[];
  overdue: number;
  byStage: { stage: string; count: number }[];
}

export default function WorkloadView() {
  const { ads, loading, error } = useAds();
  const { team, valuesFor } = useSettings();
  const stages = valuesFor("stage").filter((s) => s !== CLOSED_STAGE);

  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo<Row[]>(() => {
    return team.map((member) => {
      const field = fieldForRole(member.role);
      const active = field
        ? ads.filter((a) => a[field] === member.name && a.stage !== CLOSED_STAGE)
        : [];
      const overdue = active.filter((a) => a.due_date && a.due_date < today).length;
      const byStage = stages
        .map((stage) => ({ stage, count: active.filter((a) => a.stage === stage).length }))
        .filter((s) => s.count > 0);
      return { member, active, overdue, byStage };
    })
    .sort((a, b) => b.active.length - a.active.length);
  }, [team, ads, stages, today]);

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Workload</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
          Active ads per person, against a full plate of ~5. Green is healthy, red is overloaded.
        </p>
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}
      {error && (
        <div style={{ backgroundColor: "#450a0a", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px" }}>
          Couldn’t load workload: {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map((r) => {
            const rb = roleBadgeStyle(r.member.role);
            return (
              <div key={r.member.id} style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "14px 16px" }}>
                {/* Top row: name + role + count */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>{r.member.name}</span>
                    <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px", backgroundColor: rb.bg, color: rb.color }}>
                      {r.member.role}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {r.overdue > 0 && (
                      <span style={{ fontSize: "10px", fontWeight: 600, color: "#fca5a5", backgroundColor: "#450a0a", padding: "2px 8px", borderRadius: "10px" }}>
                        {r.overdue} overdue
                      </span>
                    )}
                    {r.active.length >= RED_AT && (
                      <span style={{ fontSize: "10px", fontWeight: 600, color: "#fca5a5", backgroundColor: "#450a0a", padding: "2px 8px", borderRadius: "10px" }}>
                        Overloaded
                      </span>
                    )}
                    <span style={{ fontSize: "14px", fontWeight: 600, color: r.active.length === 0 ? "var(--text-muted)" : "var(--text)" }}>
                      {r.active.length} active
                    </span>
                  </div>
                </div>

                {/* Capacity bar: fills toward FULL_CAPACITY, color by load */}
                <div style={{ height: "8px", backgroundColor: "var(--nested)", borderRadius: "5px", overflow: "hidden", marginBottom: r.byStage.length > 0 ? "10px" : "0" }}>
                  <div style={{
                    width: `${Math.min(100, (r.active.length / FULL_CAPACITY) * 100)}%`,
                    height: "100%", borderRadius: "5px",
                    backgroundColor: loadColor(r.active.length),
                    minWidth: r.active.length > 0 ? "6px" : "0",
                    transition: "width 0.3s",
                  }} />
                </div>

                {/* Stage breakdown chips */}
                {r.byStage.length > 0 && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {r.byStage.map((s) => (
                      <span key={s.stage} style={{ fontSize: "11px", color: "var(--text-secondary)", backgroundColor: "var(--raised)", borderRadius: "4px", padding: "2px 8px" }}>
                        {s.stage}: {s.count}
                      </span>
                    ))}
                  </div>
                )}

                {r.active.length === 0 && (
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>No active ads — free.</div>
                )}
              </div>
            );
          })}

          {rows.length === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px", border: "1px dashed var(--border)", borderRadius: "10px" }}>
              No team members yet. Invite people in Settings.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
"use client";

import { AlertTriangle } from "lucide-react";
import { useMonthlyKpi } from "@/app/hooks/useMonthlyKpi";
import { useMyRole } from "@/app/hooks/useMyRole";
import { can } from "@/app/lib/permissions";
import { kpiReminder, monthName, resolveKpi } from "@/app/lib/kpi";

// The month-end nag from the approved proposal: in the last week of a month,
// if next month has no KPI, tell the people who can set one. Everyone else
// never sees it.
export default function KpiReminderBanner({ onOpen }: { onOpen: () => void }) {
  const myRole = useMyRole();
  const { rows, loading, missing } = useMonthlyKpi();
  if (!can(myRole, "set_kpi") || loading || missing) return null;
  const next = kpiReminder(rows);
  if (!next) return null;
  return (
    <div style={{
      marginBottom: "18px", fontSize: "13px", color: "#fcd34d", backgroundColor: "rgba(201,133,0,0.12)",
      border: "1px solid rgba(201,133,0,0.4)", borderRadius: "8px", padding: "9px 12px",
      display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap",
    }}>
      <AlertTriangle size={15} />
      {monthName(next)} has no KPI yet, so {monthName(resolveKpi(rows, next).month)}&apos;s will carry over.
      <button onClick={onOpen} style={{ background: "none", border: "none", color: "#fcd34d", textDecoration: "underline", cursor: "pointer", fontSize: "13px", fontFamily: "inherit", padding: 0 }}>
        Set it in Settings
      </button>
    </div>
  );
}

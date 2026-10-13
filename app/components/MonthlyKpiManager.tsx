"use client";

import { useState } from "react";
import { Pencil, AlertTriangle } from "lucide-react";
import { useMonthlyKpi } from "@/app/hooks/useMonthlyKpi";
import { useMyRole } from "@/app/hooks/useMyRole";
import { useMyName } from "@/app/hooks/useMyName";
import { can } from "@/app/lib/permissions";
import { addMonths, kpiReminder, monthName, resolveKpi, storeMonth, KPI_DEFAULTS, type KpiRow } from "@/app/lib/kpi";

// Settings → Monthly KPI (approved with the Discord reports, 2026-10-13).
// Every report, alert, hit rate, monthly learnings report and the Ask AI
// judge a month's data by that month's row. Past months are locked (RLS too),
// so setting November can never rewrite September's winners.

const cell: React.CSSProperties = { padding: "11px 12px", fontSize: "13px", borderTop: "1px solid var(--border)", verticalAlign: "middle" };
const head: React.CSSProperties = { ...cell, borderTop: "none", fontSize: "12px", color: "var(--text-muted)", fontWeight: 500, textAlign: "left" };
const input: React.CSSProperties = {
  padding: "6px 8px", backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "6px",
  color: "var(--text)", fontSize: "13px", fontFamily: "inherit", outline: "none",
};
const money = (n: number) => "$" + n.toLocaleString("en-US");

type Draft = { goal: "" | "Profit" | "Scale"; nc: string; min: string; pot: string; days: string; watch: string };

function GoalBadge({ goal }: { goal: KpiRow["goal"] }) {
  if (!goal) return <span style={{ color: "var(--text-muted)" }}>–</span>;
  const scale = goal === "Scale";
  return (
    <span style={{
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "999px",
      backgroundColor: scale ? "rgba(57,135,229,0.15)" : "rgba(25,158,112,0.15)",
      color: scale ? "#6aa8f0" : "#3fcf98",
    }}>{goal}</span>
  );
}

export default function MonthlyKpiManager() {
  const { rows, loading, missing, save } = useMonthlyKpi();
  const myRole = useMyRole();
  const myName = useMyName();
  const canSet = can(myRole, "set_kpi");
  const current = storeMonth();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Saved months, plus this month and next even when unset, newest first.
  const months = [...new Set([...rows.map((r) => r.month), current, addMonths(current, 1)])].sort((a, b) => b.localeCompare(a));
  const reminder = kpiReminder(rows);

  function startEdit(month: string) {
    const k = resolveKpi(rows, month);
    setDraft({
      goal: k.goal ?? "",
      nc: String(k.nc_roas_target),
      min: String(k.min_spend),
      pot: String(k.potential_spend ?? KPI_DEFAULTS.potential_spend),
      days: String(k.potential_days ?? KPI_DEFAULTS.potential_days),
      watch: String(k.watch_spend ?? KPI_DEFAULTS.watch_spend),
    });
    setEditing(month);
    setError(null);
  }

  async function commit() {
    if (!editing || !draft) return;
    const nc = Number(draft.nc), min = Number(draft.min), pot = Number(draft.pot), days = Number(draft.days), watch = Number(draft.watch);
    if (!(nc > 0 && nc < 20)) return setError("NC ROAS target must be a number like 0.95.");
    if (!(min >= 0)) return setError("Minimum spend must be 0 or more.");
    if (!(pot > 0) || !(watch > 0) || watch >= pot) return setError("The watching line must be above $0 and below the potential line.");
    if (!(Number.isInteger(days) && days >= 1 && days <= 30)) return setError("Potential window must be 1–30 days.");
    setSaving(true);
    const err = await save({
      month: editing,
      goal: draft.goal || null,
      nc_roas_target: nc,
      min_spend: min,
      potential_spend: pot,
      potential_days: days,
      watch_spend: watch,
      set_by: myName,
    });
    setSaving(false);
    if (err) return setError(err);
    setEditing(null);
    setDraft(null);
  }

  return (
    <div style={{ marginBottom: "40px" }}>
      <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 4px" }}>Monthly KPI</h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "13px", margin: "0 0 14px", maxWidth: "760px" }}>
        The winner rule for each month. The Discord reports, potential-ad alerts, hit rate, monthly learnings report,
        Strategists view and Ask AI all judge results by the KPI of the month they belong to. Months follow the store&apos;s
        clock (Adelaide). {canSet ? "You can edit this month and later; past months are locked." : "Founders and Media Buyers can edit."}
      </p>

      {missing && (
        <div style={{ marginBottom: "12px", fontSize: "13px", color: "#fcd34d", backgroundColor: "rgba(201,133,0,0.12)", border: "1px solid rgba(201,133,0,0.4)", borderRadius: "8px", padding: "9px 12px" }}>
          The <code>monthly_kpi</code> table hasn&apos;t been created yet. Run <code>discord_reports_schema.sql</code> in Supabase → SQL Editor.
          Until then everything uses the rule in Learnings → Monthly reports.
        </div>
      )}

      {!missing && reminder && (
        <div style={{ marginBottom: "12px", fontSize: "13px", color: "#fcd34d", backgroundColor: "rgba(201,133,0,0.12)", border: "1px solid rgba(201,133,0,0.4)", borderRadius: "8px", padding: "9px 12px", display: "flex", gap: "8px", alignItems: "center" }}>
          <AlertTriangle size={15} />
          {monthName(reminder)} has no KPI yet, so {monthName(resolveKpi(rows, reminder).month)}&apos;s will be used. Set it before the 1st to change what counts as a winner.
        </div>
      )}

      {error && (
        <div style={{ marginBottom: "10px", fontSize: "13px", color: "#fca5a5", backgroundColor: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "8px", padding: "9px 12px" }}>
          {error}
        </div>
      )}

      {!loading && !missing && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflowX: "auto", backgroundColor: "var(--card)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "720px" }}>
            <thead>
              <tr>
                <th style={head}>Month</th>
                <th style={head}>Goal</th>
                <th style={head}>KPI</th>
                <th style={head}>Min. spend to judge</th>
                <th style={head}>Potential ad</th>
                <th style={head}>Watching</th>
                <th style={head} />
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const own = rows.find((r) => r.month === m);
                const k = resolveKpi(rows, m);
                const open = m >= current;
                const isEditing = editing === m && draft;
                const label = (
                  <td style={{ ...cell, fontWeight: 600, whiteSpace: "nowrap" }}>
                    {monthName(m, "short")}
                    {m === current && <span style={{ marginLeft: "6px", fontSize: "11px", color: "var(--accent)", fontWeight: 500 }}>this month</span>}
                  </td>
                );

                if (isEditing) {
                  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
                  return (
                    <tr key={m}>
                      {label}
                      <td style={cell}>
                        <select value={draft.goal} onChange={(e) => set({ goal: e.target.value as Draft["goal"] })} style={input}>
                          <option value="">–</option>
                          <option value="Profit">Profit</option>
                          <option value="Scale">Scale</option>
                        </select>
                      </td>
                      <td style={{ ...cell, whiteSpace: "nowrap" }}>
                        NC ROAS ≥ <input value={draft.nc} onChange={(e) => set({ nc: e.target.value })} style={{ ...input, width: "58px" }} inputMode="decimal" />
                      </td>
                      <td style={{ ...cell, whiteSpace: "nowrap" }}>
                        $ <input value={draft.min} onChange={(e) => set({ min: e.target.value })} style={{ ...input, width: "70px" }} inputMode="numeric" />
                      </td>
                      <td style={{ ...cell, whiteSpace: "nowrap" }}>
                        $ <input value={draft.pot} onChange={(e) => set({ pot: e.target.value })} style={{ ...input, width: "70px" }} inputMode="numeric" /> within{" "}
                        <input value={draft.days} onChange={(e) => set({ days: e.target.value })} style={{ ...input, width: "40px" }} inputMode="numeric" /> days
                      </td>
                      <td style={{ ...cell, whiteSpace: "nowrap" }}>
                        $ <input value={draft.watch} onChange={(e) => set({ watch: e.target.value })} style={{ ...input, width: "64px" }} inputMode="numeric" />
                      </td>
                      <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
                        <button onClick={commit} disabled={saving} style={{ padding: "6px 12px", borderRadius: "6px", border: "none", backgroundColor: "var(--accent)", color: "#0d0d0f", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => { setEditing(null); setDraft(null); setError(null); }} style={{ marginLeft: "6px", padding: "6px 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "none", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={m} style={{ opacity: own ? 1 : 0.75 }}>
                    {label}
                    <td style={cell}><GoalBadge goal={own?.goal ?? null} /></td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>
                      NC ROAS ≥ {k.nc_roas_target}
                      {!own && (
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {k.source === "carried" ? `not set: ${monthName(k.month, "short")}'s carries over` : "not set: Learnings rule"}
                        </div>
                      )}
                    </td>
                    <td style={cell}>{money(k.min_spend)}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>{money(k.potential_spend)} within {k.potential_days} days</td>
                    <td style={cell}>{money(k.watch_spend)}</td>
                    <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right", fontSize: "12px", color: "var(--text-muted)" }}>
                      {canSet && open ? (
                        <button onClick={() => startEdit(m)} disabled={!!editing} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "5px 10px", borderRadius: "6px", border: "1px solid var(--border)", background: "none", color: "var(--text)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}>
                          <Pencil size={12} /> {own ? "Edit" : "Set"}
                        </button>
                      ) : !open ? "locked (month over)" : null}
                      {own?.set_by && <div style={{ marginTop: "3px" }}>set by {own.set_by}{own.updated_at ? ` · ${new Date(own.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: "10px 0 0", maxWidth: "760px" }}>
        Goal is a label so everyone knows which mode the month is in. Potential ad = a creative launched within the window that has spent the
        potential amount at or above the KPI (daily report); Watching lists the ones past the lower line.
      </p>
    </div>
  );
}

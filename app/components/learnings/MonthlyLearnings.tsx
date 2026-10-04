"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Sparkles, TrendingUp, TrendingDown, Target, Lightbulb, Pencil } from "lucide-react";
import { useMonthlyLearnings, type MonthlyLearningsReport } from "@/app/hooks/useMonthlyLearnings";
import { useMyRole } from "@/app/hooks/useMyRole";
import { can } from "@/app/lib/permissions";
import type { LearningBrief, ReportMode, ReportView, Verdict } from "@/app/lib/monthlyLearnings";
import type { LearningsSummary } from "@/app/hooks/useMonthlyLearnings";
import { formatCreated, monthLabel } from "@/app/lib/adDates";
import type { Ad } from "@/app/types";

// A tag bucket with fewer judged briefs than this is shown, but greyed and
// labelled "thin" — a 2-brief bucket at 1.4x must not read like a 20-brief one.
const THIN_BUCKET = 3;

const VERDICT_STYLE: Record<Verdict, { bg: string; fg: string; bar: string }> = {
  Winner: { bg: "#052e16", fg: "#4ade80", bar: "#16a34a" },
  Loser: { bg: "#450a0a", fg: "#fca5a5", bar: "#dc2626" },
  "Too early": { bg: "var(--raised)", fg: "var(--text-secondary)", bar: "var(--border)" },
  "No spend found": { bg: "transparent", fg: "var(--text-muted)", bar: "var(--border)" },
};

// Reports saved before 2026-10-04's created-month view had one flat view and
// one summary. Read them as the launched view rather than breaking them.
function viewsOf(report: MonthlyLearningsReport): { launched: ReportView; created: ReportView | null } {
  const d = report.data as unknown as Record<string, unknown>;
  if (d.launched) return { launched: report.data.launched, created: report.data.created };
  const legacy = d as unknown as ReportView;
  return { launched: { ...legacy, totals: { ...legacy.totals, not_launched: 0 } }, created: null };
}

function summaryOf(report: MonthlyLearningsReport, mode: ReportMode): LearningsSummary | null {
  const s = report.summary as unknown as Record<string, unknown> | null;
  if (!s) return null;
  if ("headline" in s) return mode === "launched" ? (s as unknown as LearningsSummary) : null;
  return (s[mode] as LearningsSummary | null) ?? null;
}

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const x2 = (n: number | null) => (n == null ? "—" : n.toFixed(2));

// The last six whole-or-partial months, newest first.
function recentMonths(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

export default function MonthlyLearnings({ ads, onOpenAd }: { ads: Ad[]; onOpenAd: (ad: Ad) => void }) {
  const { reports, loading, tableMissing, generating, error, generate } = useMonthlyLearnings();
  const role = useMyRole();
  const canEditRule = can(role, "edit_performance");

  const months = useMemo(() => {
    const set = new Set([...recentMonths(), ...reports.map((r) => r.month)]);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [reports]);

  // Default to the newest saved report, else last month.
  const [picked, setPicked] = useState<string | null>(null);
  const month = picked ?? reports[0]?.month ?? recentMonths()[1];
  const report = reports.find((r) => r.month === month) ?? null;

  const [editingRule, setEditingRule] = useState(false);
  const [minSpend, setMinSpend] = useState("");
  const [ncTarget, setNcTarget] = useState("");

  function runGenerate() {
    const rule =
      editingRule && minSpend !== "" && ncTarget !== ""
        ? { minSpend: Number(minSpend), ncTarget: Number(ncTarget) }
        : undefined;
    generate(month, rule).then((r) => {
      if (r) setEditingRule(false);
    });
  }

  const busy = generating === month;

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
        <select
          value={month}
          onChange={(e) => setPicked(e.target.value)}
          style={{
            backgroundColor: "var(--nested)", color: "var(--text)", border: "1px solid var(--border)",
            borderRadius: "6px", padding: "6px 10px", fontSize: "13px", fontFamily: "inherit",
          }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}{reports.some((r) => r.month === m) ? "" : " (not generated)"}
            </option>
          ))}
        </select>

        <button
          onClick={runGenerate}
          disabled={!!generating}
          style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "6px 14px", borderRadius: "6px",
            border: "none", backgroundColor: "var(--accent)", color: "#0d0d0f", fontSize: "13px",
            fontWeight: 600, cursor: generating ? "wait" : "pointer", opacity: generating && !busy ? 0.5 : 1,
            fontFamily: "inherit",
          }}
        >
          {report ? <RefreshCw size={14} /> : <Sparkles size={14} />}
          {busy ? "Generating… (about a minute)" : report ? "Regenerate" : "Generate report"}
        </button>

        <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
          {editingRule ? (
            <>
              Winner = NC ROAS ≥
              <RuleInput value={ncTarget} onChange={setNcTarget} width={52} />
              on ≥ $
              <RuleInput value={minSpend} onChange={setMinSpend} width={64} />
              spend
              <button onClick={() => setEditingRule(false)} style={linkBtn}>cancel</button>
            </>
          ) : (
            <>
              Winner = NC ROAS ≥ {report?.nc_roas_target ?? 0.95} on ≥ {money(report?.min_spend ?? 500)} spend
              {canEditRule && (
                <button
                  onClick={() => {
                    setNcTarget(String(report?.nc_roas_target ?? 0.95));
                    setMinSpend(String(report?.min_spend ?? 500));
                    setEditingRule(true);
                  }}
                  style={linkBtn}
                  title="Change the winner rule (applies on the next generate)"
                >
                  <Pencil size={11} />
                </button>
              )}
            </>
          )}
        </span>
      </div>

      {tableMissing && (
        <Notice tone="warn">
          Reports can be generated but not saved yet — the <code>monthly_learnings</code> table hasn&apos;t been
          created. Run <code>monthly_learnings_schema.sql</code> in Supabase.
        </Notice>
      )}
      {report?.save_error && !tableMissing && <Notice tone="warn">{report.save_error}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}

      {!loading && !report && !busy && (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px", border: "1px dashed var(--border)", borderRadius: "10px" }}>
          No report for {monthLabel(month)} yet. Generate one — it finds every brief that started spending that
          month, calls each a winner or loser on NC ROAS, and writes up what worked.
          <br />
          Reports are also written automatically on the 2nd of every month.
        </div>
      )}

      {report && <ReportBody report={report} ads={ads} onOpenAd={onOpenAd} />}
    </div>
  );
}

function ReportBody({ report, ads, onOpenAd }: { report: MonthlyLearningsReport; ads: Ad[]; onOpenAd: (ad: Ad) => void }) {
  const d = report.data;
  const views = viewsOf(report);
  const [mode, setMode] = useState<ReportMode>("launched");
  const v = (mode === "created" ? views.created : null) ?? views.launched;
  const summary = summaryOf(report, mode);
  const [verdict, setVerdict] = useState<Verdict | "all">("all");
  const dims = useMemo(() => [...new Set(v.tags.map((t) => t.dimension))], [v.tags]);
  const [dim, setDim] = useState("Persona");

  const briefs = v.briefs.filter((b) => verdict === "all" || b.verdict === verdict);
  const tagRows = v.tags.filter((t) => t.dimension === dim);
  const word = mode === "launched" ? "launched" : "created";
  const target = d.nc_roas_target;

  const open = (b: LearningBrief) => {
    const ad = ads.find((a) => a.id === b.ad_id);
    if (ad) onOpenAd(ad);
  };

  const by = report.generated_by === "cron" ? "automatically" : report.generated_by ? `by ${report.generated_by}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
        Generated {new Date(report.generated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} {by}
        {" · "}performance is lifetime through {d.as_of}, so it keeps maturing — regenerate later for fuller numbers.
      </div>

      {/* Which month definition */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: "8px", padding: "2px" }}>
          {([
            { key: "launched", label: `Launched in ${monthLabel(d.month)}` },
            { key: "created", label: `Created in ${monthLabel(d.month)}` },
          ] as const).map((o) => {
            const active = mode === o.key;
            const disabled = o.key === "created" && !views.created;
            return (
              <button
                key={o.key}
                onClick={() => { setMode(o.key); setVerdict("all"); }}
                disabled={disabled}
                title={disabled ? "This report was made before the Created view existed. Regenerate it." : undefined}
                style={{
                  padding: "5px 12px", borderRadius: "6px", border: "none", fontFamily: "inherit", fontSize: "12px",
                  cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
                  backgroundColor: active ? "var(--accent)" : "transparent",
                  color: active ? "#0d0d0f" : "var(--text-secondary)", fontWeight: active ? 600 : 400,
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {mode === "launched"
            ? "Briefs whose first Meta ad started spending this month."
            : "Briefs whose card was created in the dashboard this month — same as the board's Created filter. Ones with no spend found are either not live yet or named in Meta without their DTC #."}
        </span>
      </div>

      {/* Tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px" }}>
        <Tile label={`Briefs ${word}`} value={String(v.totals.briefs)} />
        <Tile label="Winners" value={String(v.totals.winners)} color="#4ade80" />
        <Tile label="Losers" value={String(v.totals.losers)} color="#fca5a5" />
        <Tile label={`Too early (< ${money(d.min_spend)})`} value={String(v.totals.too_early)} />
        {mode === "created" && <Tile label="No spend found" value={String(v.totals.not_launched)} />}
        <Tile label="Spend on these briefs" value={money(v.totals.spend)} />
        <Tile
          label="NC ROAS, these briefs"
          value={x2(v.totals.nc_roas)}
          sub={d.account ? `account ${x2(d.account.nc_roas)} that month` : undefined}
        />
      </div>

      {/* Write-up */}
      <Card>
        {summary ? (
          <>
            <div style={{ fontSize: "15px", lineHeight: 1.55, color: "var(--text)", marginBottom: "16px" }}>
              {summary.headline}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "18px" }}>
              <Section icon={<TrendingUp size={14} color="#4ade80" />} title="What worked" items={summary.what_worked} />
              <Section icon={<TrendingDown size={14} color="#fca5a5" />} title="What didn't" items={summary.what_didnt} />
              <Section icon={<Lightbulb size={14} color="#facc15" />} title="Patterns" items={summary.patterns} />
              <Section icon={<Target size={14} color="#60a5fa" />} title="Bets for next month" items={summary.next_month} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "14px" }}>
              Written by Claude from the numbers below. Check anything you act on against the table.
            </div>
          </>
        ) : (
          <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            No written summary{report.summary_error ? `: ${report.summary_error}` : "."} The numbers below are complete.
          </div>
        )}
      </Card>

      {/* Briefs */}
      <Card title={`Briefs ${word} in ${monthLabel(d.month)}`}>
        <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
          {(mode === "created"
            ? (["all", "Winner", "Loser", "Too early", "No spend found"] as const)
            : (["all", "Winner", "Loser", "Too early"] as const)
          ).map((f) => {
            const count = f === "all" ? v.briefs.length : v.briefs.filter((b) => b.verdict === f).length;
            const active = verdict === f;
            return (
              <button
                key={f}
                onClick={() => setVerdict(f)}
                style={{
                  padding: "4px 11px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", cursor: "pointer",
                  border: active ? "none" : "1px solid var(--border)",
                  backgroundColor: active ? "var(--accent)" : "transparent",
                  color: active ? "#0d0d0f" : "var(--text-secondary)", fontWeight: active ? 600 : 400,
                }}
              >
                {f === "all" ? "All" : f === "Winner" ? "Winners" : f === "Loser" ? "Losers" : f}{" "}
                <span style={{ opacity: 0.6 }}>{count}</span>
              </button>
            );
          })}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {["DTC", "Brief", "Verdict", "Created", "Launched", "Spend", "NC ROAS", "ROAS", "CPA", "Meta ads", "Persona", "Format", "Strategist"].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i >= 5 && i <= 9 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {briefs.map((b) => (
                <tr key={b.ad_id} onClick={() => open(b)} style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <td style={td}>{b.dtc_number != null ? `#${b.dtc_number}` : "—"}</td>
                  <td style={{ ...td, maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.name}>
                    {b.name || "Untitled"}
                  </td>
                  <td style={td}><VerdictBadge v={b.verdict} /></td>
                  <td style={{ ...td, color: "var(--text-secondary)" }}>{b.created_at ? formatCreated(b.created_at) : "—"}</td>
                  <td style={{ ...td, color: "var(--text-secondary)" }}>{b.first_spend ? formatCreated(b.first_spend + "T00:00:00Z") : "—"}</td>
                  <td style={tdNum}>{money(b.spend)}</td>
                  <td style={{ ...tdNum, fontWeight: 600, color: b.verdict === "Too early" || b.verdict === "No spend found" ? "var(--text-secondary)" : (b.nc_roas ?? 0) >= target ? "#4ade80" : "#fca5a5" }}>
                    {x2(b.nc_roas)}
                  </td>
                  <td style={tdNum}>{x2(b.roas)}</td>
                  <td style={tdNum}>{b.cpa == null ? "—" : "$" + b.cpa.toFixed(0)}</td>
                  <td style={tdNum}>{b.meta_ads}</td>
                  <td style={tdMuted}>{b.persona || "—"}</td>
                  <td style={tdMuted}>{b.format || "—"}</td>
                  <td style={tdMuted}>{b.strategist || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Tag breakdown */}
      <Card title="What the winners have in common">
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
          {dims.map((x) => (
            <button
              key={x}
              onClick={() => setDim(x)}
              style={{
                padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontFamily: "inherit", cursor: "pointer",
                border: dim === x ? "none" : "1px solid var(--border)",
                backgroundColor: dim === x ? "var(--accent)" : "transparent",
                color: dim === x ? "#0d0d0f" : "var(--text-secondary)", fontWeight: dim === x ? 600 : 400,
              }}
            >
              {x}
            </button>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>{dim}</th>
                <th style={{ ...th, textAlign: "right" }}>Briefs</th>
                <th style={{ ...th, textAlign: "right" }}>Judged</th>
                <th style={{ ...th, textAlign: "right" }}>Winners</th>
                <th style={{ ...th, textAlign: "right" }}>Spend</th>
                <th style={{ ...th, textAlign: "right" }}>NC ROAS</th>
              </tr>
            </thead>
            <tbody>
              {tagRows.map((t) => {
                const thin = t.judged < THIN_BUCKET;
                return (
                  <tr key={t.value} style={{ opacity: thin ? 0.55 : 1 }}>
                    <td style={td}>
                      {t.value}
                      {thin && <span style={{ marginLeft: "8px", fontSize: "10px", color: "var(--text-muted)" }}>thin</span>}
                    </td>
                    <td style={tdNum}>{t.briefs}</td>
                    <td style={tdNum}>{t.judged}</td>
                    <td style={{ ...tdNum, color: t.winners > 0 ? "#4ade80" : "var(--text-secondary)" }}>{t.winners}</td>
                    <td style={tdNum}>{money(t.spend)}</td>
                    <td style={{ ...tdNum, fontWeight: 600, color: thin ? "var(--text-secondary)" : (t.nc_roas ?? 0) >= target ? "#4ade80" : "var(--text)" }}>
                      {x2(t.nc_roas)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "10px" }}>
          NC ROAS is blended (all new-customer revenue ÷ all spend in the bucket). &quot;Thin&quot; = fewer than {THIN_BUCKET} briefs
          with enough spend to judge — don&apos;t read much into those.
        </div>
      </Card>

      {mode === "launched" && d.unmatched.ads > 0 && (
        <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          Not counted: {d.unmatched.ads} Meta ads ({money(d.unmatched.spend)}) also started spending this month but
          carry no DTC number the dashboard knows
          {d.unmatched.top.length > 0 && <> — largest: {d.unmatched.top.slice(0, 3).map((u) => `“${u.adset_name || u.ad_name}”`).join(", ")}</>}.
        </div>
      )}
    </div>
  );
}

function RuleInput({ value, onChange, width }: { value: string; onChange: (v: string) => void; width: number }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
      inputMode="decimal"
      style={{
        width, backgroundColor: "var(--nested)", color: "var(--text)", border: "1px solid var(--border)",
        borderRadius: "4px", padding: "3px 6px", fontSize: "12px", fontFamily: "inherit",
      }}
    />
  );
}

function VerdictBadge({ v }: { v: Verdict }) {
  const s = VERDICT_STYLE[v];
  return (
    <span style={{ fontSize: "10px", fontWeight: 600, padding: "1px 8px", borderRadius: "10px", backgroundColor: s.bg, color: s.fg, whiteSpace: "nowrap" }}>
      {v}
    </span>
  );
}

function Tile({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px 14px" }}>
      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 600, color: color ?? "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "16px 18px" }}>
      {title && <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "12px" }}>{title}</div>}
      {children}
    </div>
  );
}

function Section({ icon, title, items }: { icon: React.ReactNode; title: string; items: string[] }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>
        {icon}
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "7px" }}>
        {items.map((it, i) => (
          <li key={i} style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--text)" }}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const s = tone === "error"
    ? { bg: "#450a0a", fg: "#fca5a5", bd: "#7f1d1d" }
    : { bg: "#422006", fg: "#fcd34d", bd: "#713f12" };
  return (
    <div style={{ backgroundColor: s.bg, color: s.fg, padding: "10px 14px", borderRadius: "8px", border: `1px solid ${s.bd}`, fontSize: "13px", marginBottom: "14px" }}>
      {children}
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer",
  padding: "0 2px", fontSize: "12px", fontFamily: "inherit", display: "inline-flex", alignItems: "center",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: "13px" };
const th: React.CSSProperties = {
  padding: "7px 10px", fontSize: "11px", fontWeight: 500, color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", textAlign: "left",
};
const td: React.CSSProperties = { padding: "7px 10px", borderBottom: "1px solid var(--border-soft)", whiteSpace: "nowrap" };
const tdNum: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const tdMuted: React.CSSProperties = { ...td, color: "var(--text-secondary)" };

"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { roleBadgeStyle } from "@/app/lib/roleStyles";
import { useAskChat } from "@/app/components/ask/AskChatProvider";
import type { BriefRow, StrategistReport, StrategistRow, Sums } from "@/app/lib/strategistPerf";

// Performance per strategist over the last 7 / 30 / 90 days (Axel's ask,
// 2026-10-09). Data comes from /api/strategist-perf: Triple Whale per-ad rows
// matched to briefs exactly as Ask AI and the monthly report do it, then
// summed by assigned_strategist. Every ratio is sum-over-sum.

const WINDOWS = [7, 30, 90] as const;
const GOOD = "#4ade80";
const BAD = "#fca5a5";

// ---- derived metrics (all from additive sums) ----
const div = (a: number, b: number) => (b > 0 ? a / b : null);
const m = {
  ncRoas: (s: Sums) => div(s.nc_revenue, s.spend),
  roas: (s: Sums) => div(s.revenue, s.spend),
  cpa: (s: Sums) => div(s.spend, s.purchases),
  ctr: (s: Sums) => div(s.clicks * 100, s.impressions),
  outCtr: (s: Sums) => div(s.outbound_clicks * 100, s.impressions),
  cpm: (s: Sums) => div(s.spend * 1000, s.impressions),
  hook: (s: Sums) => div(s.v3s * 100, s.video_impressions),
  hold: (s: Sums) => div(s.thruplays * 100, s.v3s),
  cvr: (s: Sums) => div(s.purchases * 100, s.clicks),
};

const usd = (n: number | null) =>
  n == null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const usd2 = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const x2 = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)}x`);
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
const pct2 = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)}%`);
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

type SortKey = "name" | "spend" | "share" | "nc" | "roas" | "cpa" | "ctr" | "outctr" | "cpm" | "hook" | "hold" | "live" | "launched" | "created" | "winners";

export default function StrategistsView() {
  const { openDtc } = useAskChat();
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  // One report per window, kept while the view is open so flipping 7 ↔ 30
  // doesn't re-run Triple Whale each time.
  const [reports, setReports] = useState<Record<number, StrategistReport>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "spend", asc: false });

  const load = useCallback(async (d: number, force = false) => {
    if (!force && reports[d]) return;
    setLoading(true);
    setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setLoading(false); return; }
      const res = await fetch("/api/strategist-perf", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ days: d }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error || "Couldn't load strategist performance.");
      else setReports((r) => ({ ...r, [d]: json.report }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load strategist performance.");
    }
    setLoading(false);
  }, [reports]);

  useEffect(() => { load(days); }, [days, load]);

  const report = reports[days];

  const rows = useMemo(() => {
    if (!report) return [];
    const total = report.matched.spend;
    const val = (r: StrategistRow): number | string | null => {
      switch (sort.key) {
        case "name": return r.name.toLowerCase();
        case "spend": return r.sums.spend;
        case "share": return div(r.sums.spend, total);
        case "nc": return m.ncRoas(r.sums);
        case "roas": return m.roas(r.sums);
        case "cpa": return m.cpa(r.sums);
        case "ctr": return m.ctr(r.sums);
        case "outctr": return m.outCtr(r.sums);
        case "cpm": return m.cpm(r.sums);
        case "hook": return m.hook(r.sums);
        case "hold": return m.hold(r.sums);
        case "live": return r.briefs_live;
        case "launched": return r.briefs_launched;
        case "created": return r.briefs_created;
        case "winners": return r.winners;
      }
    };
    return report.strategists.slice().sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * (sort.asc ? 1 : -1);
    });
  }, [report, sort]);

  const toggle = (name: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === "name" || key === "cpa" || key === "cpm" }));

  const ncColor = (v: number | null, spend: number) => {
    if (v == null || !report || spend < report.rule.minSpend) return undefined;
    return v >= report.rule.ncTarget ? GOOD : BAD;
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Strategists</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px", maxWidth: "720px" }}>
            Meta performance of each strategist&apos;s briefs: spend, NC ROAS, CTR, hook rate, how many concepts they shipped, and their top spenders.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ display: "flex", gap: "2px", padding: "3px", backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "8px" }}>
            {WINDOWS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  padding: "6px 14px", borderRadius: "6px", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "13px",
                  backgroundColor: days === d ? "var(--accent)" : "transparent",
                  color: days === d ? "#0d0d0f" : "var(--text-secondary)",
                  fontWeight: days === d ? 600 : 400,
                }}
              >
                {d} days
              </button>
            ))}
          </div>
          <button
            onClick={() => load(days, true)}
            disabled={loading}
            title="Reload from Triple Whale"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--card)", color: "var(--text-secondary)", cursor: loading ? "default" : "pointer", fontSize: "13px", fontFamily: "inherit" }}
          >
            <RefreshCw size={14} style={{ animation: loading ? "ask-spin 1s linear infinite" : undefined }} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ backgroundColor: "#450a0a", color: BAD, padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px", marginBottom: "16px" }}>
          {error}
        </div>
      )}

      {!report && loading && (
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Pulling {days} days from Triple Whale… (takes ~5–10 seconds)</p>
      )}

      {report && (
        <>
          <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: "0 0 14px" }}>
            {shortDate(report.start)} – {shortDate(report.end)} · compared with {shortDate(report.prev_start)} – {shortDate(report.prev_end)} · Triple Whale pixel (Triple Attribution), all ad accounts · data to yesterday
            {loading && " · refreshing…"}
          </p>

          <Tiles report={report} />

          <Section title="By strategist" note="Click a row for that strategist's briefs. Click a header to sort.">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", fontVariantNumeric: "tabular-nums" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <SortTh k="name" sort={sort} onSort={sortBy}>Strategist</SortTh>
                    <SortTh k="spend" sort={sort} onSort={sortBy} right>Spend</SortTh>
                    <SortTh k="share" sort={sort} onSort={sortBy} right>Share</SortTh>
                    <SortTh k="nc" sort={sort} onSort={sortBy} right>NC ROAS</SortTh>
                    <SortTh k="roas" sort={sort} onSort={sortBy} right>ROAS</SortTh>
                    <SortTh k="cpa" sort={sort} onSort={sortBy} right>CPA</SortTh>
                    <SortTh k="ctr" sort={sort} onSort={sortBy} right>CTR</SortTh>
                    <SortTh k="outctr" sort={sort} onSort={sortBy} right>Outbound CTR</SortTh>
                    <SortTh k="cpm" sort={sort} onSort={sortBy} right>CPM</SortTh>
                    <SortTh k="hook" sort={sort} onSort={sortBy} right>Hook</SortTh>
                    <SortTh k="hold" sort={sort} onSort={sortBy} right>Hold</SortTh>
                    <SortTh k="live" sort={sort} onSort={sortBy} right title="Briefs that spent in this window">Live</SortTh>
                    <SortTh k="launched" sort={sort} onSort={sortBy} right title="Briefs whose first-ever Meta spend is in this window">Launched</SortTh>
                    <SortTh k="created" sort={sort} onSort={sortBy} right title="Cards created in this window">Created</SortTh>
                    <SortTh k="winners" sort={sort} onSort={sortBy} right title="Of the briefs launched in this window, judged on lifetime NC ROAS">W / L / early</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isOpen = open.has(r.name);
                    const rb = r.role ? roleBadgeStyle(r.role) : null;
                    const nc = m.ncRoas(r.sums);
                    return (
                      <Fragment key={r.name}>
                        <tr
                          onClick={() => toggle(r.name)}
                          style={{ borderBottom: "1px solid var(--border-soft)", cursor: "pointer", backgroundColor: isOpen ? "var(--hover)" : undefined }}
                        >
                          <Td>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                              {isOpen ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
                              <span style={{ fontWeight: 600 }}>{r.name}</span>
                              {rb && r.role !== "Strategist" && (
                                <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px", backgroundColor: rb.bg, color: rb.color }}>{r.role}</span>
                              )}
                            </span>
                          </Td>
                          <Td right>
                            {usd(r.sums.spend)}
                            <Delta now={r.sums.spend} prev={r.prev.spend} neutral />
                          </Td>
                          <Td right muted>{pct(div(r.sums.spend * 100, report.matched.spend))}</Td>
                          <Td right color={ncColor(nc, r.sums.spend)}>
                            {x2(nc)}
                            <Delta now={nc} prev={m.ncRoas(r.prev)} ratio />
                          </Td>
                          <Td right>{x2(m.roas(r.sums))}</Td>
                          <Td right>{usd2(m.cpa(r.sums))}</Td>
                          <Td right>{pct2(m.ctr(r.sums))}</Td>
                          <Td right>{pct2(m.outCtr(r.sums))}</Td>
                          <Td right>{usd2(m.cpm(r.sums))}</Td>
                          <Td right>{pct(m.hook(r.sums))}</Td>
                          <Td right>{pct(m.hold(r.sums))}</Td>
                          <Td right>{r.briefs_live}</Td>
                          <Td right>{r.briefs_launched}</Td>
                          <Td right>{r.briefs_created}</Td>
                          <Td right>
                            <span style={{ color: r.winners ? GOOD : "var(--text-muted)" }}>{r.winners}</span>
                            <span style={{ color: "var(--text-muted)" }}> / </span>
                            <span style={{ color: r.losers ? BAD : "var(--text-muted)" }}>{r.losers}</span>
                            <span style={{ color: "var(--text-muted)" }}> / {r.too_early}</span>
                          </Td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={15} style={{ padding: "4px 0 14px 28px", backgroundColor: "var(--hover)", borderBottom: "1px solid var(--border)" }}>
                              {r.briefs.length ? (
                                <BriefTable briefs={r.briefs} report={report} onOpen={openDtc} />
                              ) : (
                                <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: "10px 0" }}>No brief of theirs spent in this window.</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Top spenders" note={`The 10 briefs with the most spend, ${shortDate(report.start)} – ${shortDate(report.end)}.`}>
            <BriefTable briefs={report.top_briefs} report={report} onOpen={openDtc} showStrategist />
          </Section>

          <p style={{ color: "var(--text-muted)", fontSize: "12px", lineHeight: 1.6, marginTop: "4px" }}>
            {report.unmatched_spend > 0 && (
              <>
                {usd(report.unmatched_spend)} of {usd(report.total.spend)} spend in this window isn&apos;t attributed to any strategist (Meta ads with no DTC number, or a DTC number with no card).{" "}
              </>
            )}
            Hook rate = 3-second video views ÷ impressions; hold rate = ThruPlays ÷ 3-second views. Both count video ads only.
            Launched = the brief&apos;s first-ever Meta spend falls in this window. Winner / Loser / too early uses the team&apos;s rule on lifetime numbers to yesterday:
            NC ROAS ≥ {report.rule.ncTarget} on at least {usd(report.rule.minSpend)}. On 7 days most launches are still too early.
          </p>
        </>
      )}
    </div>
  );
}

function Tiles({ report }: { report: StrategistReport }) {
  const t = report.total;
  const p = report.prev_total;
  const live = report.strategists.reduce((s, r) => s + r.briefs_live, 0);
  const launched = report.strategists.reduce((s, r) => s + r.briefs_launched, 0);
  const created = report.strategists.reduce((s, r) => s + r.briefs_created, 0);
  const tiles: { label: string; value: string; delta?: React.ReactNode; sub?: string }[] = [
    { label: "Spend", value: usd(t.spend), delta: <Delta now={t.spend} prev={p.spend} neutral /> },
    { label: "NC ROAS", value: x2(m.ncRoas(t)), delta: <Delta now={m.ncRoas(t)} prev={m.ncRoas(p)} ratio /> },
    { label: "ROAS", value: x2(m.roas(t)), delta: <Delta now={m.roas(t)} prev={m.roas(p)} ratio /> },
    { label: "CTR", value: pct2(m.ctr(t)), delta: <Delta now={m.ctr(t)} prev={m.ctr(p)} ratio /> },
    { label: "Hook rate", value: pct(m.hook(t)), sub: `hold ${pct(m.hold(t))}` },
    { label: "Concepts", value: `${launched} launched`, sub: `${live} live · ${created} created` },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px", marginBottom: "20px" }}>
      {tiles.map((x) => (
        <div key={x.label} style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "12px 14px" }}>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{x.label}</div>
          <div style={{ fontSize: "20px", fontWeight: 600, marginTop: "4px", fontVariantNumeric: "tabular-nums" }}>{x.value}</div>
          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px", minHeight: "16px" }}>
            {x.delta}{x.sub}
          </div>
        </div>
      ))}
    </div>
  );
}

function BriefTable({ briefs, report, onOpen, showStrategist }: {
  briefs: (BriefRow & { strategist?: string })[];
  report: StrategistReport;
  onOpen: (dtc: number) => void;
  showStrategist?: boolean;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px", fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <Th>Brief</Th>
            {showStrategist && <Th>Strategist</Th>}
            <Th>Editor</Th>
            <Th>Launched</Th>
            <Th right>Spend</Th>
            <Th right>NC ROAS</Th>
            <Th right>ROAS</Th>
            <Th right>CPA</Th>
            <Th right>CTR</Th>
            <Th right>Hook</Th>
            <Th right>Hold</Th>
            <Th right>Lifetime</Th>
          </tr>
        </thead>
        <tbody>
          {briefs.map((b) => {
            const nc = m.ncRoas(b.sums);
            return (
              <tr key={b.id} style={{ borderBottom: "1px solid var(--border-soft)" }}>
                <Td>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (b.dtc != null) onOpen(b.dtc); }}
                    style={{ display: "flex", alignItems: "center", gap: "10px", background: "none", border: "none", padding: 0, cursor: b.dtc != null ? "pointer" : "default", color: "inherit", fontFamily: "inherit", fontSize: "inherit", textAlign: "left" }}
                  >
                    {b.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.thumbnail} alt="" style={{ width: "34px", height: "34px", objectFit: "cover", borderRadius: "6px", flexShrink: 0, backgroundColor: "var(--raised)" }} />
                    ) : (
                      <span style={{ width: "34px", height: "34px", borderRadius: "6px", flexShrink: 0, backgroundColor: "var(--raised)" }} />
                    )}
                    <span>
                      <span style={{ fontWeight: 600 }}>DTC #{b.dtc ?? "—"}</span>{" "}
                      <span style={{ color: "var(--text-secondary)" }}>{b.name.length > 42 ? b.name.slice(0, 40) + "…" : b.name}</span>
                      <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)" }}>{b.stage}</span>
                    </span>
                  </button>
                </Td>
                {showStrategist && <Td muted>{b.strategist}</Td>}
                <Td muted>{b.self_produced ? "Self-produced" : b.editor ?? "—"}</Td>
                <Td muted>{b.launched ? shortDate(b.launched) : "—"}</Td>
                <Td right>{usd(b.sums.spend)}</Td>
                <Td right color={nc != null && b.sums.spend >= report.rule.minSpend ? (nc >= report.rule.ncTarget ? GOOD : BAD) : undefined}>{x2(nc)}</Td>
                <Td right>{x2(m.roas(b.sums))}</Td>
                <Td right>{usd2(m.cpa(b.sums))}</Td>
                <Td right>{pct2(m.ctr(b.sums))}</Td>
                <Td right>{pct(m.hook(b.sums))}</Td>
                <Td right>{pct(m.hold(b.sums))}</Td>
                <Td right>
                  <span title={`Lifetime spend ${usd(b.lifetime_spend)} at ${x2(b.lifetime_nc_roas)} NC ROAS`}>
                    {b.verdict ? (
                      <span style={{ color: b.verdict === "Winner" ? GOOD : b.verdict === "Loser" ? BAD : "var(--text-muted)" }}>{b.verdict}</span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>{usd(b.lifetime_spend)} · {x2(b.lifetime_nc_roas)}</span>
                    )}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Change vs the previous equal-length window. Spend is neutral (more isn't
// better or worse); ratios are coloured, and shown as a point change.
function Delta({ now, prev, neutral, ratio }: { now: number | null; prev: number | null; neutral?: boolean; ratio?: boolean }) {
  if (now == null || prev == null || prev === 0) return null;
  const change = ratio ? now - prev : ((now - prev) / prev) * 100;
  if (!Number.isFinite(change)) return null;
  const up = change >= 0;
  const color = neutral ? "var(--text-muted)" : up ? GOOD : BAD;
  const label = ratio ? `${up ? "+" : "−"}${Math.abs(change).toFixed(2)}` : `${up ? "+" : "−"}${Math.abs(change).toFixed(0)}%`;
  return <span style={{ display: "block", fontSize: "11px", color }}>{label} vs prev</span>;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px", flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>{title}</h2>
        {note && <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function SortTh({ k, sort, onSort, right, title, children }: {
  k: SortKey; sort: { key: SortKey; asc: boolean }; onSort: (k: SortKey) => void; right?: boolean; title?: string; children: React.ReactNode;
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onSort(k)}
      title={title}
      style={{ padding: "10px 12px", fontWeight: 500, color: active ? "var(--text)" : "var(--text-secondary)", textAlign: right ? "right" : "left", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
    >
      {children}{active ? (sort.asc ? " ↑" : " ↓") : ""}
    </th>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{ padding: "8px 12px", fontWeight: 500, color: "var(--text-secondary)", textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function Td({ children, right, muted, color }: { children: React.ReactNode; right?: boolean; muted?: boolean; color?: string }) {
  return (
    <td style={{ padding: "9px 12px", textAlign: right ? "right" : "left", color: color ?? (muted ? "var(--text-muted)" : "var(--text)"), whiteSpace: "nowrap", verticalAlign: "middle" }}>
      {children}
    </td>
  );
}

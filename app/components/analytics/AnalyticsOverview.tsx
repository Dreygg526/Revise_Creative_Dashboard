"use client";

import { useMemo, useState } from "react";
import { effectivePerf, type Ad } from "@/app/types";
import { usePerfSeries, type DailyPoint } from "@/app/hooks/usePerfSeries";

// One hue for every bar. Each panel plots a single measure (magnitude), so
// there is nothing for a categorical palette to distinguish — colouring bars
// by row would encode rank, which reshuffles whenever a filter changes.
const DATA_HUE = "#3987e5";
const PREV_HUE = "#6b7280";
// Second series on the Top Spend chart. Blue/orange is the pair that survives
// every colour-vision check on this dark ground; Atria's purple/teal doesn't.
const CPA_HUE = "#d95926";

// The strategy fields a brief is tagged with. This is the whole argument for
// building this here rather than reading Atria: these values were typed by a
// strategist at brief time, not inferred from the creative afterwards.
const TAG_DIMENSIONS = [
  { key: "persona", label: "Persona" },
  { key: "core_emotion", label: "Core Emotion" },
  { key: "problem", label: "Problem" },
  { key: "awareness", label: "Awareness" },
  { key: "ad_type", label: "Ad Type" },
  { key: "concept", label: "Concept" },
  { key: "format", label: "Format" },
] as const;

type TagKey = (typeof TAG_DIMENSIONS)[number]["key"];

// Only additive measures are bar-chartable. ROAS and CPA are ratios — drawing
// them as bar length would make a $300 ad with two lucky orders outrank a
// $50k one — so they ride along as text instead.
const METRICS = [
  { key: "spend", label: "Spend", money: true },
  { key: "revenue", label: "Revenue", money: true },
  { key: "purchases", label: "Purchases", money: false },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

// The KPI row. `lowerIsBetter` flips the delta colour — a falling CPA is good
// news and must not render red.
const KPIS = [
  { key: "spend", label: "Spend", kind: "money", lowerIsBetter: false },
  { key: "revenue", label: "Revenue", kind: "money", lowerIsBetter: false },
  { key: "roas", label: "ROAS", kind: "ratio", lowerIsBetter: false },
  { key: "purchases", label: "Purchases", kind: "count", lowerIsBetter: false },
  { key: "cpa", label: "CPA", kind: "currency", lowerIsBetter: true },
  { key: "aov", label: "AOV", kind: "currency", lowerIsBetter: false },
  { key: "cvr", label: "CVR", kind: "percent", lowerIsBetter: false },
] as const;

type KpiKey = (typeof KPIS)[number]["key"];

interface Bucket {
  label: string;
  spend: number;
  revenue: number;
  purchases: number;
  ads: number;
  roas: number | null;
  cpa: number | null;
}

function money(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function count(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
// Bar labels sit ~30px apart, so they have to stay short or neighbouring
// labels collide. Decimals are dropped wherever they don't change the read.
function compactMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `$${Math.round(n / 1000)}K`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1000).toFixed(1)}K`;
  if (Math.abs(n) >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

// One day's value for a KPI. Ratios can be undefined on a day with no
// denominator; those points break the line rather than plotting as zero,
// which would read as a crash rather than an absence.
function dailyValue(p: DailyPoint, key: KpiKey): number | null {
  switch (key) {
    case "spend": return p.spend;
    case "revenue": return p.revenue;
    case "purchases": return p.purchases;
    case "roas": return p.spend > 0 ? p.revenue / p.spend : null;
    case "cpa": return p.purchases > 0 ? p.spend / p.purchases : null;
    case "aov": return p.purchases > 0 ? p.revenue / p.purchases : null;
    case "cvr": return p.clicks > 0 ? (p.purchases / p.clicks) * 100 : null;
  }
}

// The window total — computed from summed components, never by averaging the
// daily ratios. Mean-of-ratios would weight a $200 day the same as a $20k one.
function windowValue(points: DailyPoint[], key: KpiKey): number | null {
  if (points.length === 0) return null;
  let spend = 0, revenue = 0, purchases = 0, clicks = 0;
  for (const p of points) {
    spend += p.spend; revenue += p.revenue; purchases += p.purchases; clicks += p.clicks;
  }
  switch (key) {
    case "spend": return spend;
    case "revenue": return revenue;
    case "purchases": return purchases;
    case "roas": return spend > 0 ? revenue / spend : null;
    case "cpa": return purchases > 0 ? spend / purchases : null;
    case "aov": return purchases > 0 ? revenue / purchases : null;
    case "cvr": return clicks > 0 ? (purchases / clicks) * 100 : null;
  }
}

function formatKpi(v: number | null, kind: string): string {
  if (v == null) return "—";
  if (kind === "money") return money(v);
  if (kind === "currency") return `$${v.toFixed(2)}`;
  if (kind === "ratio") return `${v.toFixed(2)}x`;
  if (kind === "percent") return `${v.toFixed(2)}%`;
  return count(v);
}

// Revenue ÷ ad spend, knowing nothing about product margin — 1x means the ad
// spend came back, not that anything was profitable.
function roasColor(roas: number | null): string {
  if (roas == null) return "var(--text-muted)";
  if (roas >= 2) return "#4ade80";
  if (roas >= 1) return "#fbbf24";
  return "#fca5a5";
}

function bucketBy(ads: Ad[], key: TagKey): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const ad of ads) {
    const raw = ad[key];
    const label = raw && String(raw).trim() ? String(raw) : "— Unassigned";
    let b = map.get(label);
    if (!b) {
      b = { label, spend: 0, revenue: 0, purchases: 0, ads: 0, roas: null, cpa: null };
      map.set(label, b);
    }
    const perf = effectivePerf(ad);
    b.ads++;
    b.spend += perf.spend ?? 0;
    b.revenue += perf.revenue ?? 0;
    b.purchases += perf.purchases ?? 0;
  }
  for (const b of map.values()) {
    b.roas = b.spend > 0 && b.revenue > 0 ? b.revenue / b.spend : null;
    b.cpa = b.purchases > 0 ? b.spend / b.purchases : null;
  }
  return [...map.values()];
}

// The KPI tiles carry their own window, independent of the sync range. Syncing
// wants "all time" for the best match coverage, but an all-time window has no
// prior window to compare against — which is exactly how the previous-period
// line ends up invisible. These all have a real preceding period.
const KPI_WINDOWS = [
  { key: "last_7d", label: "Last 7 days" },
  { key: "last_30d", label: "Last 30 days" },
  { key: "last_90d", label: "Last 90 days" },
] as const;

export default function AnalyticsOverview({
  ads, targetCpa, onOpenAd,
}: {
  ads: Ad[];
  targetCpa: number | null;
  onOpenAd: (ad: Ad) => void;
}) {
  const [metric, setMetric] = useState<MetricKey>("spend");
  const [kpiWindow, setKpiWindow] = useState<string>("last_30d");
  const { current, previous, loading: seriesLoading } = usePerfSeries(kpiWindow);

  const topAds = useMemo(() => {
    return ads
      .map((ad) => ({ ad, perf: effectivePerf(ad) }))
      .filter((x) => (x.perf.spend ?? 0) > 0)
      .sort((a, b) => (b.perf.spend ?? 0) - (a.perf.spend ?? 0))
      .slice(0, 8);
  }, [ads]);

  const hasAdData = topAds.length > 0;
  const hasSeries = current.length > 0;

  if (!hasAdData && !hasSeries && !seriesLoading) {
    return (
      <div style={{
        border: "1px dashed var(--border)", borderRadius: "10px",
        padding: "40px 24px", textAlign: "center", marginBottom: "24px",
      }}>
        <div style={{ fontSize: "14px", color: "var(--text-secondary)", marginBottom: "6px" }}>
          No performance data yet
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          Hit “Sync performance” above to pull spend, purchases and revenue.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>

      {/* ---------- Key metrics ---------- */}
      <Card>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "16px", flexWrap: "wrap", marginBottom: "14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>Key Metrics</h2>
            <select
              value={kpiWindow}
              onChange={(e) => setKpiWindow(e.target.value)}
              style={{
                padding: "5px 9px", borderRadius: "6px", border: "1px solid var(--border)",
                backgroundColor: "var(--nested)", color: "var(--text)", fontSize: "12px",
                fontFamily: "inherit", cursor: "pointer", outline: "none",
              }}
            >
              {KPI_WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
            </select>
            <Legend faded={previous.length === 0} />
          </div>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            Whole ad account · not filtered by the selection above
          </span>
        </div>

        {previous.length === 0 && current.length > 0 && (
          <p style={{ fontSize: "11px", color: "#fbbf24", margin: "0 0 12px" }}>
            No data in the preceding {KPI_WINDOWS.find((w) => w.key === kpiWindow)?.label.toLowerCase()},
            so there’s nothing to compare against — deltas and the dashed line are hidden.
          </p>
        )}

        {seriesLoading && current.length === 0 ? (
          <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: "20px 0" }}>Loading metrics…</div>
        ) : !hasSeries ? (
          <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: "20px 0" }}>
            No daily data for this window.
          </div>
        ) : (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px",
          }}>
            {KPIS.map((k) => {
              const now = windowValue(current, k.key);
              const then = windowValue(previous, k.key);
              const delta = now != null && then != null && then !== 0 ? ((now - then) / Math.abs(then)) * 100 : null;
              return (
                <MetricCard
                  key={k.key}
                  label={k.label}
                  value={formatKpi(now, k.kind)}
                  valueColor={k.key === "roas" ? roasColor(now) : undefined}
                  delta={delta}
                  lowerIsBetter={k.lowerIsBetter}
                  sub={k.key === "roas" ? "revenue ÷ ad spend · margin-blind"
                    : k.key === "cpa" && targetCpa != null ? `target $${targetCpa}`
                    : k.key === "cvr" ? "blended across clicks" : undefined}
                  currentSeries={current.map((p) => dailyValue(p, k.key))}
                  previousSeries={previous.map((p) => dailyValue(p, k.key))}
                />
              );
            })}
          </div>
        )}
      </Card>

      {/* ---------- Top creative tags ---------- */}
      <Card>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "16px", flexWrap: "wrap", marginBottom: "14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>Top Creative Tags</h2>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
              style={{
                padding: "5px 9px", borderRadius: "6px", border: "1px solid var(--border)",
                backgroundColor: "var(--nested)", color: "var(--text)", fontSize: "12px",
                fontFamily: "inherit", cursor: "pointer", outline: "none",
              }}
            >
              {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            Tagged by a strategist on the brief, not inferred from the creative
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: "10px" }}>
          {TAG_DIMENSIONS.map((dim) => (
            <TagPanel key={dim.key} title={dim.label} buckets={bucketBy(ads, dim.key)} metric={metric} />
          ))}
        </div>
      </Card>

      {/* ---------- Top spend ---------- */}
      <Card>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: "16px", flexWrap: "wrap", marginBottom: "6px",
        }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>Top Spend</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "11px", color: "var(--text-secondary)" }}>
            <Swatch color={DATA_HUE} label="Spend" />
            <Swatch color={CPA_HUE} label="CPA" />
          </div>
        </div>
        <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "0 0 14px" }}>
          Grouped by ad, sorted by spend. The two bars use separate scales — compare each colour
          across ads, not the two colours against each other.
        </p>

        {!hasAdData ? (
          <div style={{ fontSize: "13px", color: "var(--text-muted)", padding: "16px 0" }}>
            No ads with spend yet.
          </div>
        ) : (
          <TopSpendChart items={topAds} onOpenAd={onOpenAd} />
        )}
      </Card>
    </div>
  );
}

// ---------- pieces ----------

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: "var(--card)", border: "1px solid var(--border)",
      borderRadius: "12px", padding: "16px 18px",
    }}>
      {children}
    </div>
  );
}

function Legend({ faded }: { faded: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px", fontSize: "11px", color: "var(--text-secondary)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke={DATA_HUE} strokeWidth="2" /></svg>
        Selected window
      </span>
      {/* Dimmed rather than removed when there's no prior data, so the legend
          doesn't reflow every time the window changes. */}
      <span style={{ display: "flex", alignItems: "center", gap: "6px", opacity: faded ? 0.35 : 1 }}>
        <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke={PREV_HUE} strokeWidth="2" strokeDasharray="3 3" /></svg>
        Previous period
      </span>
    </div>
  );
}

// Catmull-Rom through the points, converted to cubic beziers. A raw polyline
// over daily figures reads as noise; the curve shows the trend, which is what
// a sparkline is for.
function smoothRun(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

// Both series share one y-scale so the comparison is honest — scaling each to
// its own extent would make any two periods look identical.
function Sparkline({ current, previous }: { current: (number | null)[]; previous: (number | null)[] }) {
  const W = 100, H = 30;
  const all = [...current, ...previous].filter((v): v is number => v != null && Number.isFinite(v));
  if (all.length < 2) return <div style={{ height: `${H}px` }} />;
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || Math.abs(max) || 1;
  // Pad the domain well beyond the data so the line sits in the middle band of
  // the box instead of slamming into both edges. Without this every metric
  // looks equally volatile, because every one is stretched to full height.
  const pad = span * 0.55;
  const lo = min - pad, hi = max + pad;
  const range = hi - lo || 1;

  const path = (vals: (number | null)[]): string => {
    const n = vals.length;
    if (n < 2) return "";
    // Split on gaps so a day without a denominator breaks the line rather
    // than being bridged across as if it held a value.
    const runs: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    vals.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        if (run.length) runs.push(run);
        run = [];
        return;
      }
      run.push({ x: (i / (n - 1)) * W, y: H - ((v - lo) / range) * H });
    });
    if (run.length) runs.push(run);
    return runs.map(smoothRun).join(" ");
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <path d={path(previous)} fill="none" stroke={PREV_HUE} strokeWidth="1.5" strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <path d={path(current)} fill="none" stroke={DATA_HUE} strokeWidth="2"
        vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricCard({
  label, value, valueColor, delta, lowerIsBetter, sub, currentSeries, previousSeries,
}: {
  label: string; value: string; valueColor?: string;
  delta: number | null; lowerIsBetter: boolean; sub?: string;
  currentSeries: (number | null)[]; previousSeries: (number | null)[];
}) {
  const good = delta == null ? null : lowerIsBetter ? delta < 0 : delta > 0;
  return (
    <div style={{
      backgroundColor: "var(--nested)", border: "1px solid var(--border-soft)",
      borderRadius: "10px", padding: "12px 13px",
      display: "flex", flexDirection: "column", gap: "6px",
    }}>
      <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <span style={{
          fontSize: "21px", fontWeight: 600, letterSpacing: "-0.02em",
          color: valueColor ?? "var(--text)", fontVariantNumeric: "tabular-nums", lineHeight: 1.15,
        }}>
          {value}
        </span>
        {delta != null && (
          <span style={{
            fontSize: "11px", fontWeight: 600, padding: "1px 6px", borderRadius: "5px",
            fontVariantNumeric: "tabular-nums",
            backgroundColor: good ? "#052e16" : "#450a0a",
            color: good ? "#4ade80" : "#fca5a5",
          }}>
            {delta > 0 ? "+" : ""}{delta.toFixed(2)}%
          </span>
        )}
      </div>
      <Sparkline current={currentSeries} previous={previousSeries} />
      {sub && <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>{sub}</span>}
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ width: "9px", height: "9px", borderRadius: "3px", backgroundColor: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

// Round an axis maximum up to a readable 1 / 2 / 5 × 10^n step.
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

const CHART_H = 150;
const TICKS = 4;

function TopSpendChart({
  items, onOpenAd,
}: {
  items: { ad: Ad; perf: ReturnType<typeof effectivePerf> }[];
  onOpenAd: (ad: Ad) => void;
}) {
  const spendMax = niceMax(Math.max(...items.map((i) => i.perf.spend ?? 0)));
  const cpaMax = niceMax(Math.max(...items.map((i) => i.perf.cpa ?? 0), 1));

  return (
    // paddingTop is load-bearing: setting overflow-x to auto makes the
    // vertical axis clip as well, which was cutting the top gridline label and
    // the tallest bar's value in half. The headroom keeps both inside the box.
    <div style={{ overflowX: "auto", paddingTop: "20px" }}>
      <div style={{ display: "flex", gap: "10px", minWidth: `${items.length * 116 + 108}px` }}>

        {/* Left axis — spend */}
        <Axis max={spendMax} label="Spend" color={DATA_HUE} format={(v) => money(v)} align="right" />

        {/* Plot. Bars, thumbnail and label live in ONE column element per ad —
            two sibling flex rows can't be relied on to compute equal widths,
            which is what threw the thumbnails out of line with their bars. */}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {/* Gridlines span the plot area only, behind the bars, recessive. */}
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: `${CHART_H}px`, pointerEvents: "none" }}>
            {Array.from({ length: TICKS + 1 }, (_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute", left: 0, right: 0, top: `${(i / TICKS) * CHART_H}px`,
                  borderTop: i === TICKS ? "1px solid var(--border)" : "1px dashed var(--border-soft)",
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: "12px", position: "relative" }}>
            {items.map(({ ad, perf }) => {
              const sH = Math.max(((perf.spend ?? 0) / spendMax) * CHART_H, 2);
              const cH = perf.cpa != null ? Math.max((perf.cpa / cpaMax) * CHART_H, 2) : 0;
              const title = ad.ad_name || (ad.dtc_number != null ? `DTC #${ad.dtc_number}` : "Untitled");
              return (
                <button
                  key={ad.id}
                  onClick={() => onOpenAd(ad)}
                  title={`${title}\n${money(perf.spend ?? 0)} spend · ${count(perf.purchases ?? 0)} purchases${perf.cpa != null ? ` · $${perf.cpa.toFixed(2)} CPA` : ""}${perf.roas != null ? ` · ${perf.roas.toFixed(2)}x ROAS` : ""}`}
                  style={{
                    flex: "1 0 104px", minWidth: "104px",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    fontFamily: "inherit", textAlign: "center",
                  }}
                >
                  <div style={{
                    height: `${CHART_H}px`, width: "100%",
                    display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "10px",
                  }}>
                    <BarWithLabel height={sH} color={DATA_HUE} label={compactMoney(perf.spend ?? 0)} />
                    {perf.cpa != null && (
                      <BarWithLabel height={cH} color={CPA_HUE} label={compactMoney(perf.cpa)} />
                    )}
                  </div>
                  <div style={{ width: "64px" }}>
                    <Thumb src={ad.meta_ad_image_url} dtc={ad.dtc_number} />
                  </div>
                  <span style={{
                    fontSize: "10.5px", color: "var(--text)", width: "100%",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {title}
                  </span>
                  <span style={{ fontSize: "10px", color: roasColor(perf.roas), fontVariantNumeric: "tabular-nums" }}>
                    {perf.roas != null ? `${perf.roas.toFixed(2)}x` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right axis — CPA */}
        <Axis max={cpaMax} label="CPA" color={CPA_HUE} format={(v) => `$${Math.round(v)}`} align="left" />
      </div>
    </div>
  );
}

function BarWithLabel({ height, color, label }: { height: number; color: string; label: string }) {
  return (
    <div style={{ position: "relative", width: "22px", height: `${height}px` }}>
      <span style={{
        position: "absolute", bottom: "100%", left: "50%", transform: "translateX(-50%)",
        marginBottom: "3px", fontSize: "9.5px", color: "var(--text-secondary)",
        whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
      }}>
        {label}
      </span>
      <div style={{
        width: "100%", height: "100%", backgroundColor: color,
        // Rounded at the data end only, so bars read as anchored to the axis.
        borderRadius: "3px 3px 1px 1px",
      }} />
    </div>
  );
}

function Axis({
  max, label, color, format, align,
}: {
  max: number; label: string; color: string; format: (v: number) => string; align: "left" | "right";
}) {
  return (
    <div style={{ width: "54px", flexShrink: 0, display: "flex", flexDirection: "column" }}>
      <div style={{
        position: "relative", height: `${CHART_H}px`,
        textAlign: align === "right" ? "right" : "left",
      }}>
        <span style={{
          position: "absolute", bottom: "100%", marginBottom: "4px",
          [align === "right" ? "right" : "left"]: 0,
          fontSize: "10px", color, fontWeight: 600, whiteSpace: "nowrap",
        }}>
          {label}
        </span>
        {Array.from({ length: TICKS + 1 }, (_, i) => (
          <span
            key={i}
            style={{
              position: "absolute", top: `${(i / TICKS) * CHART_H}px`,
              [align === "right" ? "right" : "left"]: 0,
              transform: "translateY(-50%)",
              fontSize: "9.5px", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums",
            }}
          >
            {format(max * (1 - i / TICKS))}
          </span>
        ))}
      </div>
    </div>
  );
}

function Thumb({ src, dtc }: { src: string | null; dtc: number | null }) {
  if (!src) {
    return (
      <div style={{
        width: "100%", aspectRatio: "1 / 1", borderRadius: "6px",
        backgroundColor: "var(--raised)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "10px", color: "var(--text-muted)",
      }}>
        {dtc != null ? `#${dtc}` : "—"}
      </div>
    );
  }
  return (
    // Plain img rather than next/image: these are Triple Whale CDN URLs that
    // would each need whitelisting in next.config, for a thumbnail.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      style={{
        width: "100%", aspectRatio: "1 / 1", objectFit: "cover",
        borderRadius: "6px", border: "1px solid var(--border)", display: "block",
      }}
    />
  );
}

function TagPanel({ title, buckets, metric }: { title: string; buckets: Bucket[]; metric: MetricKey }) {
  const spec = METRICS.find((m) => m.key === metric)!;
  const sorted = [...buckets].sort((a, b) => b[metric] - a[metric]).filter((b) => b[metric] > 0);
  const shown = sorted.slice(0, 6);
  const rest = sorted.slice(6);
  const max = shown[0]?.[metric] ?? 1;
  const total = sorted.reduce((s, b) => s + b[metric], 0);

  return (
    <div style={{
      border: "1px solid var(--border-soft)", borderRadius: "10px",
      padding: "13px 14px", display: "flex", flexDirection: "column", gap: "9px",
      backgroundColor: "var(--nested)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "13px", fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
          {sorted.length} {sorted.length === 1 ? "value" : "values"}
        </span>
      </div>

      {shown.length === 0 ? (
        <span style={{ fontSize: "12px", color: "var(--text-muted)", padding: "6px 0" }}>Nothing tagged yet.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
          {shown.map((b) => {
            const share = total > 0 ? (b[metric] / total) * 100 : 0;
            return (
              <div
                key={b.label}
                title={`${b.label}\n${spec.money ? money(b[metric]) : count(b[metric])} ${spec.label.toLowerCase()} · ${share.toFixed(1)}% of ${title.toLowerCase()}\n${b.ads} ${b.ads === 1 ? "ad" : "ads"}${b.roas != null ? ` · ${b.roas.toFixed(2)}x ROAS` : ""}${b.cpa != null ? ` · $${b.cpa.toFixed(2)} CPA` : ""}`}
                style={{ display: "grid", gridTemplateColumns: "minmax(0, 92px) 1fr auto", alignItems: "center", gap: "9px" }}
              >
                <span style={{
                  fontSize: "11.5px", color: "var(--text-secondary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {b.label}
                </span>
                <div style={{ height: "9px", backgroundColor: "var(--raised)", borderRadius: "5px", overflow: "hidden", minWidth: 0 }}>
                  <div style={{
                    width: `${Math.max((b[metric] / max) * 100, 2)}%`, height: "100%",
                    backgroundColor: DATA_HUE, borderRadius: "2px 5px 5px 2px",
                  }} />
                </div>
                <span style={{
                  fontSize: "11px", color: "var(--text-muted)",
                  fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: "52px", textAlign: "right",
                }}>
                  {spec.money ? money(b[metric]) : count(b[metric])}
                </span>
              </div>
            );
          })}
          {rest.length > 0 && (
            <span style={{ fontSize: "10px", color: "var(--text-muted)", paddingTop: "1px" }}>
              + {rest.length} more, {spec.money ? money(rest.reduce((s, b) => s + b[metric], 0)) : count(rest.reduce((s, b) => s + b[metric], 0))} combined
            </span>
          )}
        </div>
      )}
    </div>
  );
}

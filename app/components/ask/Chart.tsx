"use client";

import { useState } from "react";

// Small SVG chart for chat answers. Claude writes a ```chart JSON block; this
// draws it. One value axis only (one `format` per chart), at most 4 series.
// Palette: the dashboard's validated dark categorical slots — blue / orange
// are the Top Spend pair; aqua and yellow pass the same CVD checks on #141416.

export interface ChartSpec {
  type: "bar" | "line";
  title?: string;
  x: string[];
  series: { name: string; values: (number | null)[] }[];
  format?: "usd" | "ratio" | "pct" | "number";
}

const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const W = 640;
const H = 240;
const PAD = { top: 12, right: 12, bottom: 34, left: 52 };

export function parseChart(raw: string): ChartSpec | null {
  try {
    const s = JSON.parse(raw);
    if (!s || (s.type !== "bar" && s.type !== "line") || !Array.isArray(s.x) || !Array.isArray(s.series) || !s.series.length) return null;
    const x = s.x.slice(0, 24).map(String);
    const series = s.series.slice(0, 4).map((se: { name?: unknown; values?: unknown[] }) => ({
      name: String(se?.name ?? ""),
      values: x.map((_: string, i: number) => {
        const v = se?.values?.[i];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      }),
    }));
    return { type: s.type, title: s.title ? String(s.title) : undefined, x, series, format: s.format };
  } catch {
    return null;
  }
}

export function fmt(v: number | null, format: ChartSpec["format"], short = false): string {
  if (v == null) return "—";
  switch (format) {
    case "usd":
      if (short && Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
      if (short && Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 2 : 0 })}`;
    case "ratio":
      return v.toFixed(2);
    case "pct":
      return `${v.toFixed(1)}%`;
    default:
      return short && Math.abs(v) >= 1_000 ? `${(v / 1_000).toFixed(1)}k` : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  // Run until a tick sits at or above the max, so the top value has a gridline over it.
  for (let t = start; ticks.length < 12; t += step) {
    ticks.push(Math.round(t * 1e6) / 1e6);
    if (t >= max - step * 0.001) break;
  }
  return ticks;
}

export default function Chart({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const { x, series, format, type } = spec;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!all.length) return null;

  // Bars start at zero (length encodes the value); lines get a padded domain.
  let lo = Math.min(...all), hi = Math.max(...all);
  if (type === "bar") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  else { const pad = (hi - lo || Math.abs(hi) || 1) * 0.15; lo = lo - pad; hi = hi + pad; if (Math.min(...all) >= 0) lo = Math.max(0, lo); }
  const ticks = niceTicks(lo, hi);
  const yMin = Math.min(ticks[0], lo), yMax = Math.max(ticks[ticks.length - 1], hi);
  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const band = plotW / x.length;
  const cx = (i: number) => PAD.left + band * i + band / 2;
  const labelEvery = Math.ceil(x.length / 12);

  const bars = () => {
    const n = series.length;
    const groupW = Math.min(band * 0.72, 18 * n + 2 * (n - 1));
    const bw = (groupW - 2 * (n - 1)) / n; // 2px surface gap between adjacent bars
    return series.map((s, si) =>
      s.values.map((v, i) => {
        if (v == null) return null;
        const x0 = cx(i) - groupW / 2 + si * (bw + 2);
        const top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
        const r = Math.min(4, bw / 2, h);
        // Rounded at the data end, square at the baseline.
        const d = v >= 0
          ? `M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${top + h} Z`
          : `M${x0},${top} V${top + h - r} Q${x0},${top + h} ${x0 + r},${top + h} H${x0 + bw - r} Q${x0 + bw},${top + h} ${x0 + bw},${top + h - r} V${top} Z`;
        return <path key={`${si}-${i}`} d={d} fill={COLORS[si]} opacity={hover == null || hover === i ? 1 : 0.45} />;
      })
    );
  };

  const lines = () =>
    series.map((s, si) => {
      let d = "";
      let pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; } // gaps break the line
        d += `${pen ? "L" : "M"}${cx(i)},${y(v)} `;
        pen = true;
      });
      return (
        <g key={si}>
          <path d={d} fill="none" stroke={COLORS[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {s.values.map((v, i) =>
            v == null || (hover !== i && x.length > 12) ? null : (
              <circle key={i} cx={cx(i)} cy={y(v)} r={4} fill={COLORS[si]} stroke="var(--card)" strokeWidth={2} />
            )
          )}
        </g>
      );
    });

  return (
    <div style={{ margin: "6px 0 14px", border: "1px solid var(--border)", borderRadius: "10px", background: "var(--card)", padding: "12px 14px 8px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>{spec.title}</div>
        <button
          onClick={() => setTable((t) => !t)}
          style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "11px", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
        >
          {table ? "Show chart" : "Show table"}
        </button>
      </div>

      {series.length > 1 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", marginBottom: "4px" }}>
          {series.map((s, si) => (
            <div key={si} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "3px", background: COLORS[si] }} />
              {s.name}
            </div>
          ))}
        </div>
      )}

      {table ? (
        <table style={{ borderCollapse: "collapse", fontSize: "12px", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--text-secondary)", fontWeight: 500, borderBottom: "1px solid var(--border)" }} />
              {series.map((s, si) => (
                <th key={si} style={{ textAlign: "right", padding: "4px 8px", color: "var(--text-secondary)", fontWeight: 500, borderBottom: "1px solid var(--border)" }}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {x.map((label, i) => (
              <tr key={i}>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid var(--border-soft)" }}>{label}</td>
                {series.map((s, si) => (
                  <td key={si} style={{ textAlign: "right", padding: "4px 8px", borderBottom: "1px solid var(--border-soft)", fontVariantNumeric: "tabular-nums" }}>{fmt(s.values[i], format)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ position: "relative" }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={spec.title}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1 : 0.5} strokeDasharray={t === 0 ? undefined : "2 3"} />
                <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--text-muted)">{fmt(t, format, true)}</text>
              </g>
            ))}
            {x.map((label, i) =>
              i % labelEvery === 0 ? (
                <text key={i} x={cx(i)} y={H - PAD.bottom + 16} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                  {label.length > 12 ? label.slice(0, 11) + "…" : label}
                </text>
              ) : null
            )}
            {hover != null && type === "line" && (
              <line x1={cx(hover)} x2={cx(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--text-muted)" strokeWidth={1} />
            )}
            {type === "bar" ? bars() : lines()}
            {/* Hit targets: the whole band per x, bigger than any mark. */}
            {x.map((_, i) => (
              <rect key={i} x={PAD.left + band * i} y={PAD.top} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            ))}
          </svg>
          {hover != null && (
            <div
              style={{
                position: "absolute", top: 0, pointerEvents: "none",
                left: `${(cx(hover) / W) * 100}%`, transform: hover > x.length / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
                background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "6px", padding: "6px 9px", fontSize: "12px", whiteSpace: "nowrap", zIndex: 2,
              }}
            >
              <div style={{ color: "var(--text-secondary)", marginBottom: "2px" }}>{x[hover]}</div>
              {series.map((s, si) => (
                <div key={si} style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--text)" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "2px", background: COLORS[si] }} />
                  {series.length > 1 && <span style={{ color: "var(--text-secondary)" }}>{s.name}</span>}
                  <span style={{ fontVariantNumeric: "tabular-nums", marginLeft: "auto" }}>{fmt(s.values[hover], format)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

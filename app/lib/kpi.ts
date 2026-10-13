// ============================================================
// MONTHLY KPI — the winner rule, set once per month (Settings → Monthly KPI).
//
// Approved 2026-10-13 with the Discord reports (proposal v2). The business
// alternates "scale hard at lower ROAS" with "high ROAS for profit", so the
// bar a creative has to clear changes month to month. Every consumer reads the
// KPI of the month its data belongs to:
//   - daily report / potential ads → the month of the day being reported
//   - hit rate, Strategists view    → each brief's launch month
//   - monthly learnings report      → the report's month
//   - Ask AI                        → the current month
//
// Resolution for a month: its own row → the latest earlier row (carried over,
// and the dashboard nags) → the legacy single rule in settings_targets.
//
// "Month" is the store's month, Australia/Adelaide, the same clock Triple
// Whale's event_date uses (found 2026-10-05 in orders_table.shop_timezone).
//
// Pure apart from loadKpis(), which only takes a client it is handed.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export const STORE_TZ = "Australia/Adelaide";

export interface KpiRow {
  month: string;              // YYYY-MM
  goal: "Profit" | "Scale" | null;
  nc_roas_target: number;
  min_spend: number;
  potential_spend: number;
  potential_days: number;
  watch_spend: number;
  set_by: string | null;
  updated_at: string | null;
}

export interface ResolvedKpi extends KpiRow {
  // Where the numbers came from: this month's own row, an earlier month's row
  // carried over, or the old one-rule-for-everything setting.
  source: "set" | "carried" | "legacy";
  for_month: string;
}

export const KPI_DEFAULTS = {
  nc_roas_target: 0.95,
  min_spend: 500,
  potential_spend: 1000,
  potential_days: 5,
  watch_spend: 500,
};

// ---- Store-clock dates -------------------------------------------------------

// YYYY-MM-DD for the store's calendar day at instant `at`.
export function storeDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function storeMonth(at: Date = new Date()): string {
  return storeDate(at).slice(0, 7);
}

// Calendar arithmetic on YYYY-MM-DD strings (UTC midnight, so no DST drift).
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ---- Resolution --------------------------------------------------------------

export function resolveKpi(
  rows: KpiRow[],
  month: string,
  legacy: { minSpend: number; ncTarget: number } = { minSpend: KPI_DEFAULTS.min_spend, ncTarget: KPI_DEFAULTS.nc_roas_target }
): ResolvedKpi {
  const own = rows.find((r) => r.month === month);
  if (own) return { ...own, source: "set", for_month: month };
  const earlier = rows.filter((r) => r.month < month).sort((a, b) => b.month.localeCompare(a.month))[0];
  if (earlier) return { ...earlier, source: "carried", for_month: month };
  return {
    month,
    goal: null,
    nc_roas_target: legacy.ncTarget,
    min_spend: legacy.minSpend,
    potential_spend: KPI_DEFAULTS.potential_spend,
    potential_days: KPI_DEFAULTS.potential_days,
    watch_spend: KPI_DEFAULTS.watch_spend,
    set_by: null,
    updated_at: null,
    source: "legacy",
    for_month: month,
  };
}

// Winner / Loser / Too early under one month's KPI. Same rule as the monthly
// learnings report: below min spend nothing is judged.
export function verdictUnder(kpi: { min_spend: number; nc_roas_target: number }, spend: number, ncRevenue: number): "Winner" | "Loser" | "Too early" {
  if (spend < kpi.min_spend) return "Too early";
  return spend > 0 && ncRevenue / spend >= kpi.nc_roas_target ? "Winner" : "Loser";
}

// The nag: from the last 7 days of a month, if next month has no row of its own.
export function kpiReminder(rows: KpiRow[], today: string = storeDate()): string | null {
  const month = today.slice(0, 7);
  const next = addMonths(month, 1);
  const lastDay = addDays(`${next}-01`, -1);
  if (daysBetween(today, lastDay) > 6) return null;
  if (rows.some((r) => r.month === next)) return null;
  return next;
}

export function monthName(month: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" });
}

// ---- Server read -------------------------------------------------------------

// All rows, oldest first. A missing table (migration not run yet) reads as no
// rows, so everything falls back to the legacy rule instead of breaking.
export async function loadKpis(admin: SupabaseClient): Promise<KpiRow[]> {
  const { data, error } = await admin.from("monthly_kpi").select("*").order("month");
  if (error) return [];
  return (data ?? []).map((r) => ({
    month: String(r.month),
    goal: (r.goal as KpiRow["goal"]) ?? null,
    nc_roas_target: Number(r.nc_roas_target),
    min_spend: Number(r.min_spend),
    potential_spend: Number(r.potential_spend),
    potential_days: Number(r.potential_days),
    watch_spend: Number(r.watch_spend),
    set_by: (r.set_by as string) ?? null,
    updated_at: (r.updated_at as string) ?? null,
  }));
}

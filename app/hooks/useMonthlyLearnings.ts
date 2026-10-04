"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { MonthlyReportData } from "@/app/lib/monthlyLearnings";

export interface LearningsSummary {
  headline: string;
  what_worked: string[];
  what_didnt: string[];
  patterns: string[];
  next_month: string[];
}

export interface MonthlyLearningsReport {
  month: string;
  generated_at: string;
  generated_by: string | null;
  as_of: string;
  min_spend: number;
  nc_roas_target: number;
  data: MonthlyReportData;
  summary: LearningsSummary | null;
  summary_error: string | null;
  saved?: boolean;          // false only for a run whose save failed
  save_error?: string | null;
}

// Saved reports are read straight from the table (signed-in read policy).
// Generating goes through /api/monthly-learnings, which holds the keys.
export function useMonthlyLearnings() {
  const [reports, setReports] = useState<MonthlyLearningsReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    const { data, error } = await supabase
      .from("monthly_learnings")
      .select("*")
      .order("month", { ascending: false });
    if (error) {
      setTableMissing(/relation|does not exist|schema cache/i.test(error.message));
      if (!/relation|does not exist|schema cache/i.test(error.message)) setError(error.message);
    } else {
      setReports((data ?? []) as MonthlyLearningsReport[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  async function generate(month: string, rule?: { minSpend: number; ncTarget: number }) {
    setGenerating(month);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/monthly-learnings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ month, ...(rule ?? {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status}).`);

      const report: MonthlyLearningsReport = {
        month: body.month,
        generated_at: new Date().toISOString(),
        generated_by: "you",
        as_of: body.data.as_of,
        min_spend: body.data.min_spend,
        nc_roas_target: body.data.nc_roas_target,
        data: body.data,
        summary: body.summary,
        summary_error: body.summary_error,
        saved: body.saved,
        save_error: body.save_error,
      };
      setReports((prev) =>
        [report, ...prev.filter((r) => r.month !== report.month)].sort((a, b) => b.month.localeCompare(a.month))
      );
      return report;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the report.");
      return null;
    } finally {
      setGenerating(null);
    }
  }

  return { reports, loading, tableMissing, generating, error, generate, fetchReports };
}

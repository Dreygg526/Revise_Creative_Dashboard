"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { KpiRow } from "@/app/lib/kpi";

// Settings → Monthly KPI. Reads every month; saves one. RLS lets members read,
// and only Founders and Media Buyers write a month that hasn't ended
// (discord_reports_schema.sql). `missing` = the table isn't there yet.
export function useMonthlyKpi() {
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  async function load() {
    const { data, error } = await supabase.from("monthly_kpi").select("*").order("month", { ascending: false });
    if (error) {
      setMissing(/relation|does not exist|schema cache/i.test(error.message));
      setRows([]);
    } else {
      setMissing(false);
      setRows((data ?? []).map((r) => ({
        ...r,
        nc_roas_target: Number(r.nc_roas_target),
        min_spend: Number(r.min_spend),
        potential_spend: Number(r.potential_spend),
        potential_days: Number(r.potential_days),
        watch_spend: Number(r.watch_spend),
      })) as KpiRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(row: Omit<KpiRow, "updated_at">): Promise<string | null> {
    const { error } = await supabase
      .from("monthly_kpi")
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "month" });
    if (error) {
      return /row-level security|permission/i.test(error.message)
        ? "Not allowed: only Founders and Media Buyers can set the KPI, and only for this month or later."
        : error.message;
    }
    await load();
    return null;
  }

  return { rows, loading, missing, save };
}

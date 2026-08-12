"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface DailyPoint {
  date: string;
  spend: number;
  purchases: number;
  revenue: number;
  impressions: number;
  clicks: number;
}

// Daily account totals for the KPI sparklines. Refetches whenever the date
// window changes, since the window is what defines both the series and the
// previous period it's compared against.
export function usePerfSeries(datePreset: string) {
  const [current, setCurrent] = useState<DailyPoint[]>([]);
  const [previous, setPrevious] = useState<DailyPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setLoading(false);
        return;
      }
      const res = await fetch("/api/perf-series", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ datePreset }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Couldn't load the performance series.");
        setCurrent([]);
        setPrevious([]);
      } else {
        setError(null);
        setCurrent(json.current ?? []);
        setPrevious(json.previous ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the performance series.");
    }
    setLoading(false);
  }, [datePreset]);

  useEffect(() => { load(); }, [load]);

  return { current, previous, loading, error, reload: load };
}

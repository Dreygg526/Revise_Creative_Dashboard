"use client";

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

// One Meta ad the sync couldn't place onto a dashboard ad.
export interface UnmatchedMetaAd {
  ad_id: string;
  ad_name: string;
  campaign_name: string | null;
  spend: number;
  purchases: number;
  reason: string;
}

export interface MetaSyncResult {
  ok: true;
  dryRun: boolean;
  syncedAt: string;
  accountId: string;
  datePreset: string;
  rowsFetched: number;
  adsMatched: number;
  adsUpdated: number;
  truncated: boolean;
  unmatched: UnmatchedMetaAd[];
  writeErrors: string[];
}

// Date ranges we expose in the UI. Values are Meta's own date_preset keys.
export const DATE_PRESETS = [
  { key: "maximum", label: "All time" },
  { key: "last_90d", label: "Last 90 days" },
  { key: "last_30d", label: "Last 30 days" },
  { key: "last_7d", label: "Last 7 days" },
] as const;

// Calls the server-side Meta sync route. The Meta token lives on the
// server — this hook only forwards the user's Supabase session so the
// route can check permissions.
export function useMetaSync() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<MetaSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async (datePreset: string = "maximum") => {
    setSyncing(true);
    setError(null);
    setResult(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        setError("You're not signed in. Refresh the page and try again.");
        return null;
      }

      const res = await fetch("/api/meta-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ datePreset }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || data?.error) {
        setError(data?.error || `Sync failed (${res.status}).`);
        return null;
      }

      setResult(data as MetaSyncResult);
      return data as MetaSyncResult;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error during sync.");
      return null;
    } finally {
      setSyncing(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { sync, syncing, result, error, dismiss };
}

// The last sync run, read back from Supabase. Without this the result
// panel only lives in React state and disappears on reload / restart.
export interface LastSyncRun {
  ran_by: string | null;
  ad_account_id: string;
  date_preset: string | null;
  rows_fetched: number;
  ads_matched: number;
  ads_updated: number;
  unmatched_count: number;
  unmatched: UnmatchedMetaAd[] | null;
  error: string | null;
  created_at: string;
}

export function useLastSyncRun() {
  const [lastRun, setLastRun] = useState<LastSyncRun | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLastRun = useCallback(async () => {
    const { data, error } = await supabase
      .from("meta_sync_runs")
      .select("ran_by, ad_account_id, date_preset, rows_fetched, ads_matched, ads_updated, unmatched_count, unmatched, error, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // A missing table just means part 2 of the schema hasn't been run yet —
    // that shouldn't break the page, so fail quiet.
    if (!error && data) setLastRun(data as LastSyncRun);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLastRun();
  }, [fetchLastRun]);

  return { lastRun, loadingLastRun: loading, refetchLastRun: fetchLastRun };
}

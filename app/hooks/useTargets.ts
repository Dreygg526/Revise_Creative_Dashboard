"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Loads the single-value targets used for color-coding (CPA, hit rate).
export function useTargets() {
  const [targetCpa, setTargetCpa] = useState<number | null>(null);
  const [targetHitRate, setTargetHitRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from("settings_targets").select("*");
      if (data) {
        const cpa = data.find((t) => t.key === "target_cpa");
        const hit = data.find((t) => t.key === "target_hit_rate");
        setTargetCpa(cpa?.value ?? null);
        setTargetHitRate(hit?.value ?? null);
      }
      setLoading(false);
    }
    load();
  }, []);

  return { targetCpa, targetHitRate, loading };
}
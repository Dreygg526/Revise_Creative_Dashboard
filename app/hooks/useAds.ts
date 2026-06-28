"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Ad } from "@/app/types";

// Data layer for ads: fetch, create, update, delete.
export function useAds() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAds = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ads")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setAds(data ?? []);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  // The next DTC number = highest existing + 1 (min 1).
  function nextDtcNumber(): number {
    const numbers = ads
      .map((a) => a.dtc_number)
      .filter((n): n is number => n != null);
    if (numbers.length === 0) return 1;
    return Math.max(...numbers) + 1;
  }

  async function createAd(fields: {
    dtc_number: number | null;
    ad_name: string;
    product: string | null;
    assigned_editor: string | null;
    assigned_strategist: string | null;
    persona: string | null;
    priority: string | null;
    created_by: string | null;
  }): Promise<Ad | null> {
    const { data, error } = await supabase
      .from("ads")
      .insert([{ ...fields, stage: "Idea" }])
      .select()
      .single();

    if (error) {
      setError(error.message);
      return null;
    }
    setAds((prev) => [data as Ad, ...prev]);
    return data as Ad;
  }

  async function updateAd(id: string, fields: Partial<Ad>): Promise<Ad | null> {
    const { data, error } = await supabase
      .from("ads")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      setError(error.message);
      return null;
    }
    setAds((prev) => prev.map((a) => (a.id === id ? (data as Ad) : a)));
    return data as Ad;
  }

  // Delete an ad permanently.
  async function deleteAd(id: string): Promise<boolean> {
    const { error } = await supabase.from("ads").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return false;
    }
    setAds((prev) => prev.filter((a) => a.id !== id));
    return true;
  }

  // Delete several ads at once.
  async function deleteMany(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    const { error } = await supabase.from("ads").delete().in("id", ids);
    if (error) {
      setError(error.message);
      return false;
    }
    setAds((prev) => prev.filter((a) => !ids.includes(a.id)));
    return true;
  }

  return { ads, loading, error, fetchAds, createAd, updateAd, deleteAd, deleteMany, nextDtcNumber };
}
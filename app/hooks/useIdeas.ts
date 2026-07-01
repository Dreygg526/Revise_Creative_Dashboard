"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface Idea {
  id: string;
  title: string;
  persona: string | null;
  angle: string | null;
  note: string | null;
  status: string;               // 'open' | 'converted'
  converted_ad_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useIdeas() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIdeas = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("ideas")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else { setIdeas(data ?? []); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);

  async function addIdea(fields: { title: string; persona: string | null; angle: string | null; note: string | null }) {
    const { data, error } = await supabase.from("ideas").insert([fields]).select().single();
    if (error) { setError(error.message); return null; }
    setIdeas((prev) => [data as Idea, ...prev]);
    return data as Idea;
  }

  async function deleteIdea(id: string) {
    const { error } = await supabase.from("ideas").delete().eq("id", id);
    if (error) { setError(error.message); return; }
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  async function markConverted(id: string, adId: string | null) {
    const { error } = await supabase.from("ideas").update({ status: "converted", converted_ad_id: adId }).eq("id", id);
    if (error) { setError(error.message); return; }
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: "converted", converted_ad_id: adId } : i)));
  }

  return { ideas, loading, error, fetchIdeas, addIdea, deleteIdea, markConverted };
}
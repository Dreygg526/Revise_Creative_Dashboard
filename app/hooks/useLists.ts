"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { SettingsList } from "@/app/types";

export function useLists() {
  const [lists, setLists] = useState<SettingsList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("settings_lists")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) setError(error.message);
    else { setLists(data ?? []); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchLists(); }, [fetchLists]);

  function valuesFor(type: string): SettingsList[] {
    return lists
      .filter((l) => l.list_type === type)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  async function addValue(type: string, value: string) {
    const existing = valuesFor(type);
    const nextOrder = existing.length > 0 ? Math.max(...existing.map((e) => e.sort_order)) + 1 : 1;
    const { data, error } = await supabase
      .from("settings_lists")
      .insert([{ list_type: type, value, sort_order: nextOrder }])
      .select()
      .single();
    if (error) { setError(error.message); return; }
    setLists((prev) => [...prev, data as SettingsList]);
  }

  async function renameValue(id: string, value: string) {
    const { error } = await supabase.from("settings_lists").update({ value }).eq("id", id);
    if (error) { setError(error.message); return; }
    setLists((prev) => prev.map((l) => (l.id === id ? { ...l, value } : l)));
  }

  async function deleteValue(id: string) {
    const { error } = await supabase.from("settings_lists").delete().eq("id", id);
    if (error) { setError(error.message); return; }
    setLists((prev) => prev.filter((l) => l.id !== id));
  }

  // Persist a new order for a list type (array of ids in desired order).
  async function reorder(type: string, orderedIds: string[]) {
    // Optimistic local update
    setLists((prev) => {
      const next = [...prev];
      orderedIds.forEach((id, idx) => {
        const item = next.find((l) => l.id === id);
        if (item) item.sort_order = idx + 1;
      });
      return [...next];
    });
    // Persist each row's new sort_order
    await Promise.all(
      orderedIds.map((id, idx) =>
        supabase.from("settings_lists").update({ sort_order: idx + 1 }).eq("id", id)
      )
    );
  }

  return { lists, loading, error, fetchLists, valuesFor, addValue, renameValue, deleteValue, reorder };
}
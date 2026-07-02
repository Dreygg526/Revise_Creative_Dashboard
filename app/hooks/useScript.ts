"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface Scene {
  id: string;
  ad_id: string;
  scene_order: number;
  spoken_line: string | null;
  visual_direction: string | null;
  created_at: string;
}

export function useScript(adId: string) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchScenes = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("script_scenes")
      .select("*")
      .eq("ad_id", adId)
      .order("scene_order", { ascending: true });
    setScenes(data ?? []);
    setLoading(false);
  }, [adId]);

  useEffect(() => { if (adId) fetchScenes(); }, [adId, fetchScenes]);

  async function addScene() {
    const nextOrder = scenes.length ? Math.max(...scenes.map((s) => s.scene_order)) + 1 : 0;
    const { data } = await supabase
      .from("script_scenes")
      .insert([{ ad_id: adId, scene_order: nextOrder, spoken_line: "", visual_direction: "" }])
      .select()
      .single();
    if (data) setScenes((prev) => [...prev, data as Scene]);
  }

  async function updateScene(id: string, fields: Partial<Pick<Scene, "spoken_line" | "visual_direction">>) {
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...fields } : s)));
    await supabase.from("script_scenes").update(fields).eq("id", id);
  }

  async function deleteScene(id: string) {
    setScenes((prev) => prev.filter((s) => s.id !== id));
    await supabase.from("script_scenes").delete().eq("id", id);
  }

  async function moveScene(id: string, dir: -1 | 1) {
    const idx = scenes.findIndex((s) => s.id === id);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= scenes.length) return;
    const reordered = [...scenes];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    // reassign scene_order sequentially
    const withOrder = reordered.map((s, i) => ({ ...s, scene_order: i }));
    setScenes(withOrder);
    // persist both changed rows
    await Promise.all(
      withOrder.map((s) => supabase.from("script_scenes").update({ scene_order: s.scene_order }).eq("id", s.id))
    );
  }

  return { scenes, loading, addScene, updateScene, deleteScene, moveScene };
}
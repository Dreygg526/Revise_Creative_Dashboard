"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { TeamMember } from "@/app/types";

export function useTeam() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("team_members")
      .select("*")
      .order("name", { ascending: true });
    if (error) setError(error.message);
    else { setTeam(data ?? []); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  // Invite via the secure server route (sends email + creates row).
  async function inviteMember(name: string, email: string, role: string): Promise<{ error: string | null }> {
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role }),
      });
      const json = await res.json();
      if (!res.ok) return { error: json.error || "Invite failed." };
      await fetchTeam();
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Invite failed." };
    }
  }

  // Add a member without sending an invite (e.g. the founder adds themselves).
  async function addMember(name: string, email: string, role: string): Promise<{ error: string | null }> {
    const { error } = await supabase
      .from("team_members")
      .insert([{ name, email, role, status: "active" }]);
    if (error) return { error: error.message };
    await fetchTeam();
    return { error: null };
  }

  async function changeRole(id: string, role: string) {
    const { error } = await supabase.from("team_members").update({ role }).eq("id", id);
    if (error) setError(error.message);
    else setTeam((prev) => prev.map((m) => (m.id === id ? { ...m, role: role as TeamMember["role"] } : m)));
  }

  async function removeMember(id: string) {
    const { error } = await supabase.from("team_members").delete().eq("id", id);
    if (error) setError(error.message);
    else setTeam((prev) => prev.filter((m) => m.id !== id));
  }

  return { team, loading, error, fetchTeam, inviteMember, addMember, changeRole, removeMember };
}
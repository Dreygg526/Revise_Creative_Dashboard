"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { SettingsList, SettingsListType, TeamMember } from "@/app/types";

// Loads the editable dropdown lists (stages, personas, etc.) and the team.
// Used by forms and the board to populate options.
export function useSettings() {
  const [lists, setLists] = useState<SettingsList[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [listsRes, teamRes] = await Promise.all([
        supabase.from("settings_lists").select("*").order("sort_order"),
        supabase.from("team_members").select("*").order("name"),
      ]);
      setLists(listsRes.data ?? []);
      setTeam(teamRes.data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  // Helper: get the values for one list type (e.g. all 'stage' values in order).
  function valuesFor(type: SettingsListType): string[] {
    return lists
      .filter((l) => l.list_type === type)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => l.value);
  }

  // Helper: team members filtered by role (e.g. only Editors).
  function teamByRole(role: string): TeamMember[] {
    return team.filter((m) => m.role === role);
  }

  return { lists, team, loading, valuesFor, teamByRole };
}
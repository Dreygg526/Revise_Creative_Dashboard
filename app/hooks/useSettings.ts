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

  // Helper: team members filtered by one or more roles.
  function teamByRole(...roles: string[]): TeamMember[] {
    return team.filter((m) => roles.includes(m.role));
  }

  // Grouped helpers for the ad-form assignment dropdowns:
  //  - Strategists list includes Founders (they can act as strategists)
  //  - Editors list includes Graphic Designers (same work)
  //  - Media Buyers
  const strategistOptions = team.filter((m) => m.role === "Strategist" || m.role === "Founder");
  const editorOptions = team.filter((m) => m.role === "Editor" || m.role === "Graphic Designer");
  const mediaBuyerOptions = team.filter((m) => m.role === "Media Buyer");

  return {
    lists, team, loading, valuesFor, teamByRole,
    strategistOptions, editorOptions, mediaBuyerOptions,
  };
}
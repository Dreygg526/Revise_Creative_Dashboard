"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/app/hooks/useAuth";

// Looks up the logged-in user's role from team_members (matched by email).
export function useMyRole() {
  const { session } = useAuth();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const email = session?.user?.email;
    if (!email) { setRole(null); return; }

    supabase
      .from("team_members")
      .select("role")
      .eq("email", email)
      .maybeSingle()
      .then(({ data }) => setRole(data?.role ?? null));
  }, [session]);

  return role;
}
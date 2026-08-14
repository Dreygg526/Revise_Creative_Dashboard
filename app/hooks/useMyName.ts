"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/app/hooks/useAuth";

// Looks up the logged-in user's NAME from team_members (matched by email).
// Ads store names, not emails, in their assignment fields — so anything
// comparing "is this mine?" has to go through this, not session.user.email.
export function useMyName() {
  const { session } = useAuth();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const email = session?.user?.email;
    if (!email) { setName(null); return; }

    supabase
      .from("team_members")
      .select("name")
      .eq("email", email)
      .maybeSingle()
      .then(({ data }) => setName(data?.name ?? null));
  }, [session]);

  return name;
}

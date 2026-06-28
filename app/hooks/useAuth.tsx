"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  needsPassword: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  setPassword: (newPassword: string) => Promise<{ error: string | null }>;
  sendReset: (email: string) => Promise<{ error: string | null }>;
  clearNeedsPassword: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    // Get the current session on load.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Listen for login/logout + invite/recovery events.
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      // These events mean the user arrived via an invite or reset link
      // and must set a password before continuing.
      if (event === "PASSWORD_RECOVERY") {
        setNeedsPassword(true);
      }
    });

    // Also catch invite links: Supabase puts "type=invite" or
    // "type=recovery" in the URL hash on arrival.
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash.includes("type=invite") || hash.includes("type=recovery")) {
        setNeedsPassword(true);
      }
    }

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setNeedsPassword(false);
  }

  // Set a new password (used by invited users + password reset).
  async function setPassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };

    // Mark this member active in team_members (match by email).
    const email = (await supabase.auth.getUser()).data.user?.email;
    if (email) {
      await supabase.from("team_members").update({ status: "active" }).eq("email", email);
    }
    setNeedsPassword(false);
    return { error: null };
  }

  // Send a password reset email.
  async function sendReset(email: string) {
    const redirectTo = typeof window !== "undefined" ? window.location.origin : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return { error: error ? error.message : null };
  }

  function clearNeedsPassword() {
    setNeedsPassword(false);
  }

  return (
    <AuthContext.Provider value={{ session, loading, needsPassword, signIn, signOut, setPassword, sendReset, clearNeedsPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
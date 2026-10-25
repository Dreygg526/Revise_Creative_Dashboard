import { createClient } from "@supabase/supabase-js";

// Read env vars without the "!" assertion so a missing value doesn't crash
// module load (which would break the whole Vercel build during prerender).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaces clearly in build/runtime logs if the env vars aren't set,
  // instead of throwing an opaque "supabaseUrl is required" at import time.
  console.warn(
    "[supabaseClient] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Set them in your environment (Vercel: Project Settings > Environment Variables)."
  );
}

// Fall back to a harmless placeholder URL so createClient never throws at build.
// At runtime with the real env vars set, this uses the correct values.
const realUrl = supabaseUrl || "https://placeholder.supabase.co";

// In the browser, go through our own domain's /sb proxy (next.config.ts)
// instead of supabase.co directly: some networks block supabase.co, which
// showed up as "NetworkError when attempting to fetch resource" (2026-10-25).
const clientUrl =
  typeof window !== "undefined" && supabaseUrl ? `${window.location.origin}/sb` : realUrl;

export const supabase = createClient(clientUrl, supabaseAnonKey || "placeholder-anon-key", {
  auth: {
    // supabase-js names the saved session after the URL's host. Pin it to the
    // real project's name so the proxy doesn't sign everyone out.
    storageKey: `sb-${new URL(realUrl).hostname.split(".")[0]}-auth-token`,
  },
});
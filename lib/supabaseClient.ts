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
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);
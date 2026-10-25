import type { NextConfig } from "next";

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // The browser reaches Supabase through our own domain (/sb/...), so a
  // network that blocks or filters supabase.co (ISP blocks, DNS filters,
  // privacy extensions) can't break the app. See lib/supabaseClient.ts.
  async rewrites() {
    if (!supabaseUrl) return [];
    return [{ source: "/sb/:path*", destination: `${supabaseUrl}/:path*` }];
  },
};

export default nextConfig;

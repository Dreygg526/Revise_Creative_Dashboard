// ============================================================
// API AUTH — the two ways a server route can trust its caller.
//
//   requireMember()   — a signed-in human. Verifies the Supabase session
//                       token, looks up their role in team_members, and
//                       checks can(role, action).
//   requireAgentKey() — a machine (Axel's OpenClaw). Verifies a shared
//                       secret against AGENT_API_KEY. No Supabase session
//                       exists for a bot, so this is a separate door.
//
// Both return a discriminated union so a route reads:
//
//   const auth = await requireMember(req, admin, "manage_team");
//   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
//
// Order matters in every route that uses these: authenticate BEFORE
// reporting anything about server config, so an anonymous caller can't
// probe env state. Same rule /api/meta-sync already follows.
// ============================================================

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { can, type Action } from "@/app/lib/permissions";

export type AuthOk = { ok: true; email: string; role: string | null };
export type AuthFail = { ok: false; error: string; status: number };
export type AuthResult = AuthOk | AuthFail;

// A key shorter than this is treated as unset. Stops a placeholder like
// "changeme" in an env file from becoming a working credential.
const MIN_KEY_LENGTH = 32;

export function bearer(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

// Service-role client. Returns null rather than throwing so the caller can
// decide the status code — and so a missing key never surfaces before auth.
export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify a browser caller's Supabase session, then their permission.
// `action` is optional — pass null to require only that they're signed in.
export async function requireMember(
  req: Request,
  admin: SupabaseClient,
  action: Action | null
): Promise<AuthResult> {
  const accessToken = bearer(req);
  if (!accessToken) {
    return { ok: false, error: "Not signed in.", status: 401 };
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  const email = userData?.user?.email ?? null;
  if (userErr || !email) {
    return { ok: false, error: "Your session expired. Sign in again.", status: 401 };
  }

  const { data: member } = await admin
    .from("team_members")
    .select("role")
    .eq("email", email)
    .maybeSingle();

  const role = (member?.role as string | undefined) ?? null;

  if (action && !can(role, action)) {
    return { ok: false, error: "You don't have permission to do that.", status: 403 };
  }

  return { ok: true, email, role };
}

// Verify a machine caller's shared secret.
// Accepts either `Authorization: Bearer <key>` or `X-API-Key: <key>` —
// OpenClaw's HTTP tools use both conventions depending on how they're set up.
export function requireAgentKey(req: Request): { ok: true } | AuthFail {
  const configured = process.env.AGENT_API_KEY || "";
  const presented = bearer(req) || (req.headers.get("x-api-key") || "").trim();

  if (!presented) {
    return { ok: false, error: "Missing API key.", status: 401 };
  }

  // An unconfigured server must not be an open one. Log for the operator,
  // but return the same message a wrong key gets — a prober learns nothing
  // about whether the integration is even switched on.
  if (configured.length < MIN_KEY_LENGTH) {
    console.warn(
      "[agent-api] AGENT_API_KEY is unset or shorter than " +
        `${MIN_KEY_LENGTH} characters — every agent request will be rejected.`
    );
    return { ok: false, error: "Invalid API key.", status: 401 };
  }

  if (!sameSecret(presented, configured)) {
    return { ok: false, error: "Invalid API key.", status: 401 };
  }

  return { ok: true };
}

// Hash both sides first so timingSafeEqual always gets equal-length buffers.
// Comparing raw strings would throw on a length mismatch, and the throw
// itself leaks the real key's length.
function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

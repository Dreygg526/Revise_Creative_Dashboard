import { NextResponse } from "next/server";
import { requireMember, serviceClient } from "@/app/lib/apiAuth";

// This route runs ONLY on the server. It uses the service_role key
// (never exposed to the browser) to send a Supabase invite email.
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // Verify the caller BEFORE reading the body or reporting server config.
    // This route can mint a Founder login, so an unauthenticated POST used to
    // be a full account-takeover path for anyone who knew the URL.
    const admin = serviceClient();
    if (!admin) {
      return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
    }

    const auth = await requireMember(req, admin, "manage_team");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { email, name, role } = await req.json();

    if (!email || !name || !role) {
      return NextResponse.json({ error: "Missing name, email, or role." }, { status: 400 });
    }

    // 1) Send the Supabase invite email. We stash name + role in metadata.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name, role },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // 2) Create / upsert the team_members row (status = invited).
    const { error: dbError } = await admin
      .from("team_members")
      .upsert(
        { name, email, role, status: "invited" },
        { onConflict: "email" }
      );

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, userId: data?.user?.id ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
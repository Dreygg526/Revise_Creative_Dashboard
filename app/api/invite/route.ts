import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// This route runs ONLY on the server. It uses the service_role key
// (never exposed to the browser) to send a Supabase invite email.
export async function POST(req: Request) {
  try {
    const { email, name, role } = await req.json();

    if (!email || !name || !role) {
      return NextResponse.json({ error: "Missing name, email, or role." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceKey) {
      return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
    }

    // Admin client (server-only).
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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
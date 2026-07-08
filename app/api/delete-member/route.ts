import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-only route. Uses the service_role key (never exposed to the browser)
// to fully delete a member: their Supabase Auth login AND their team_members row.
export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email." }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceKey) {
      return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1) Find the auth user by email (paginate through the auth user list).
    let authUserId: string | null = null;
    let page = 1;
    // Look through up to ~10 pages (10,000 users) — plenty for a team.
    while (page <= 10 && !authUserId) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      const match = data.users.find(
        (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
      );
      if (match) authUserId = match.id;
      if (data.users.length < 1000) break; // no more pages
      page++;
    }

    // 2) Delete the auth login if we found one. (If not found, we still remove the row.)
    if (authUserId) {
      const { error: delErr } = await admin.auth.admin.deleteUser(authUserId);
      if (delErr) {
        return NextResponse.json({ error: `Couldn't delete login: ${delErr.message}` }, { status: 400 });
      }
    }

    // 3) Delete the team_members row.
    const { error: dbErr } = await admin.from("team_members").delete().eq("email", email);
    if (dbErr) {
      return NextResponse.json({ error: `Removed login but couldn't remove roster row: ${dbErr.message}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, authDeleted: !!authUserId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
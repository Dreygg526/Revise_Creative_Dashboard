import { NextResponse } from "next/server";
import { requireMember, serviceClient } from "@/app/lib/apiAuth";

// Server-only route. Uses the service_role key (never exposed to the browser)
// to fully delete a member: their Supabase Auth login AND their team_members row.
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    // Verify the caller BEFORE reading the body or reporting server config.
    // Unauthenticated, this route let anyone who knew the URL delete a login.
    const admin = serviceClient();
    if (!admin) {
      return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
    }

    const auth = await requireMember(req, admin, "manage_team");
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: "Missing email." }, { status: 400 });
    }

    // Deleting your own login would sign you out and, if you're the only
    // Founder, leave nobody able to manage the team.
    if (email.toLowerCase() === auth.email.toLowerCase()) {
      return NextResponse.json(
        { error: "You can't remove your own account." },
        { status: 400 }
      );
    }

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
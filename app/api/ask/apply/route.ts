import { NextResponse } from "next/server";
import { requireMember, serviceClient } from "@/app/lib/apiAuth";
import { applyChanges, type ChangeRequest, type FieldValue } from "@/app/lib/askEdits";

// Approve (or undo) a change "Ask the dashboard" proposed. The browser sends
// back the items it was shown; they're re-validated from scratch against the
// caller's role, the gates and the card's current values, so this endpoint
// can't do anything the ad card itself wouldn't let this person do.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });

  const auth = await requireMember(req, admin, null);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const raw: unknown = body?.changes;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) {
    return NextResponse.json({ error: "changes must be a list of 1–100 items." }, { status: 400 });
  }
  const isValue = (v: unknown): v is FieldValue => v === null || typeof v === "string" || typeof v === "number";
  const requests: ChangeRequest[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    if (typeof c?.ad_id !== "string" || typeof c.field !== "string" || !isValue(c.value) || !isValue(c.expected ?? null)) {
      return NextResponse.json({ error: "Each change needs ad_id, field, value and expected." }, { status: 400 });
    }
    requests.push({ ad_id: c.ad_id, field: c.field, value: c.value, expected: (c.expected ?? null) as FieldValue });
  }

  const { data: me } = await admin.from("team_members").select("name").eq("email", auth.email).maybeSingle();
  const result = await applyChanges(admin, { role: auth.role, name: (me?.name as string | undefined) ?? null }, requests);
  return NextResponse.json(result, { status: result.applied ? 200 : 409 });
}

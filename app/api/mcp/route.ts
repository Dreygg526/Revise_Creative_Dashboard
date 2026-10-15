import { bearer, serviceClient } from "@/app/lib/apiAuth";
import { activeProvider } from "@/app/lib/tripleWhale";
import { emailForKey, handleMcp, memberFor } from "@/app/lib/mcpServer";

// The dashboard as an MCP server for a team member's own Claude Code (see
// app/lib/mcpServer.ts). Connect with:
//   claude mcp add --transport http standard-dashboard \
//     https://standardcreativedashboard.vercel.app/api/mcp \
//     --header "Authorization: Bearer <their key>"
export const runtime = "nodejs";
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function POST(req: Request) {
  // Key first, before anything about server config is revealed.
  const email = emailForKey(bearer(req));
  if (!email) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or missing dashboard key." } }, 401);

  const admin = serviceClient();
  if (!admin) return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Server is missing the service role key." } }, 500);
  const user = await memberFor(admin, email);
  if (!user) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "This key's email isn't on the team any more." } }, 403);
  if (activeProvider() !== "triple_whale") {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "The dashboard needs Triple Whale (TRIPLE_WHALE_API_KEY) for performance data." } }, 500);
  }

  const body = await req.json().catch(() => undefined);
  if (body === undefined) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, 400);

  const out = await handleMcp(body, admin, user);
  return out === null ? new Response(null, { status: 202 }) : json(out);
}

// No server-to-client stream and no sessions: GET (the SSE channel) and
// DELETE (session end) are both "not offered", which the spec allows.
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

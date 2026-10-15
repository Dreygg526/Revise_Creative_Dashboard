// Server-only: the dashboard as an MCP server, so a team member's own Claude
// Code can read briefs, performance and real ad copy, and write back (card
// edits, new Idea cards, saved copy). Built 2026-10-15 from Rob's ask, approved
// by Mickey: "connect the dash to my Claude Code so I can take inspo and use
// copy and headlines directly when I do copy".
//
// Transport is MCP "Streamable HTTP" in its simplest legal form: every POST is
// one JSON-RPC message (or a batch) answered with application/json. No
// sessions, no server-sent events, nothing held between requests, which is
// what a serverless function wants.
//
// The tools are Ask AI's own (askDashboard.ts, surface "mcp"), so every number
// matches the chat and every write goes through askEdits.ts with the caller's
// own role. Claude Code asks the user before each tool call; that prompt is
// the approval step, so writes apply as soon as they validate.
//
// Keys: one per person, in MCP_KEYS as `email=sha256(key)` pairs separated by
// commas. Only the hash is stored, so Vercel never holds a usable key. Make
// one with `node scripts/mcp-key.mjs <email>`; revoke by deleting its pair
// and redeploying. The email must be on team_members: it decides role + name.

import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BetaToolResultContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/index";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { dashboardTools } from "@/app/lib/askDashboard";

export const MCP_SERVER_NAME = "standard-creative-dashboard";
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface McpUser {
  email: string;
  role: string | null;
  name: string | null;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const MIN_KEY_LENGTH = 32;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function keyTable(): { email: string; hash: Buffer }[] {
  return (process.env.MCP_KEYS || "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.lastIndexOf("=");
      return { email: pair.slice(0, i).trim().toLowerCase(), hash: Buffer.from(pair.slice(i + 1).trim().toLowerCase(), "hex") };
    })
    .filter((k) => k.email && k.hash.length === 32);
}

// The email a presented key belongs to, or null. Every row is compared (in
// constant time) so the answer's timing doesn't say which row matched.
export function emailForKey(presented: string): string | null {
  if (presented.length < MIN_KEY_LENGTH) return null;
  const h = Buffer.from(sha256(presented), "hex");
  let found: string | null = null;
  for (const k of keyTable()) if (timingSafeEqual(h, k.hash) && !found) found = k.email;
  return found;
}

export async function memberFor(admin: SupabaseClient, email: string): Promise<McpUser | null> {
  // Compared in code, not with ilike: "_" in an address is an ilike wildcard.
  const { data } = await admin.from("team_members").select("name, role, email");
  const row = (data ?? []).find((m) => String(m.email ?? "").toLowerCase() === email.toLowerCase());
  return row ? { email: row.email as string, role: (row.role as string) ?? null, name: (row.name as string) ?? null } : null;
}

// ---------------------------------------------------------------------------
// JSON-RPC
// ---------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: RpcRequest["id"], result: unknown): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: RpcRequest["id"], code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function instructions(user: McpUser, rule: { minSpend: number; ncTarget: number }, asOf: string): string {
  return `The Standard Lab's creative dashboard (NAC supplements for liver, bloating, belly fat, hangovers). You are connected as ${user.name ?? user.email} (${user.role ?? "no role"}).
- A brief is one dashboard card with a DTC number; many Meta ads (variants, iterations) roll up into it. Name briefs "DTC #N (name)".
- Numbers are Triple Whale's pixel (Triple Attribution), all six Meta ad accounts, data to ${asOf}. NC ROAS = new-customer revenue / spend, the team's headline metric. meta_reported_* fields are Meta's own attribution (what Ads Manager shows).
- Team rule: Winner = NC ROAS >= ${rule.ncTarget} on >= $${rule.minSpend} spend; below that spend is "Too early".
- For copy work: get_ad_copy returns the real headlines and primary texts that ran, with each ad's results. Pick winners with real spend, not $40 flukes. Copy only exists for Ad Account 12345 (nearly all spend since mid-July 2026).
- Writing: propose_changes edits cards, create_idea_card makes a new Idea card, save_copy saves copy to the Copy Agent history and optionally onto a card. Each is checked against ${user.name ?? "this person"}'s role and the pipeline gates and is written as soon as it validates. Only write when the user asks.
- Never state a number that didn't come from a tool.`;
}

// Anthropic tool-result blocks -> MCP content blocks.
type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
function toMcpContent(out: string | BetaToolResultContentBlockParam[]): McpContent[] {
  if (typeof out === "string") return [{ type: "text", text: out }];
  return out.flatMap((b): McpContent[] => {
    if (b.type === "text") return [{ type: "text", text: b.text }];
    if (b.type === "image" && b.source.type === "base64") return [{ type: "image", data: b.source.data, mimeType: b.source.media_type }];
    return [];
  });
}

async function handle(msg: RpcRequest, admin: SupabaseClient, user: McpUser): Promise<RpcResponse | null> {
  const isNotification = msg.id === undefined;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      const { rule, asOf } = await dashboardTools(admin, user);
      return ok(msg.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, title: "Standard Creative Dashboard", version: "1.0.0" },
        instructions: instructions(user, rule, asOf),
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list": {
      const { tools } = await dashboardTools(admin, user);
      return ok(msg.id, {
        tools: tools.map((t) => ({
          name: t.name,
          description: "description" in t ? t.description : "",
          inputSchema: "input_schema" in t ? t.input_schema : { type: "object" },
          annotations: { readOnlyHint: !WRITE_TOOLS.has(t.name) },
        })),
      });
    }
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const { tools } = await dashboardTools(admin, user);
      // Widened to one input type: the list mixes each tool's own schema.
      const tool = tools.find((t) => t.name === name) as BetaRunnableTool<unknown> | undefined;
      if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
      let input: unknown;
      try {
        input = tool.parse(msg.params?.arguments ?? {});
      } catch (e) {
        return ok(msg.id, { content: [{ type: "text", text: `Invalid arguments: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
      }
      try {
        const out = await tool.run(input);
        console.log(`[mcp] ${user.email} ${name}`);
        return ok(msg.id, { content: toMcpContent(out) });
      } catch (e) {
        return ok(msg.id, { content: [{ type: "text", text: e instanceof Error ? e.message : "The tool failed." }], isError: true });
      }
    }
    default:
      if (isNotification) return null; // notifications/initialized, cancelled… need no answer
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

const WRITE_TOOLS = new Set(["propose_changes", "create_idea_card", "save_copy"]);

// One POST body: a single message or a batch. Returns null when every message
// was a notification (the route then answers 202 with no body).
export async function handleMcp(body: unknown, admin: SupabaseClient, user: McpUser): Promise<RpcResponse | RpcResponse[] | null> {
  const list = Array.isArray(body) ? body : [body];
  if (!list.length || list.some((m) => !m || typeof m !== "object")) return fail(null, -32600, "Invalid request.");
  const out = (await Promise.all(list.map((m) => handle(m as RpcRequest, admin, user)))).filter((r): r is RpcResponse => r !== null);
  if (!out.length) return null;
  return Array.isArray(body) ? out : out[0];
}

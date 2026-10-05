import { requireMember, serviceClient } from "@/app/lib/apiAuth";
import { activeProvider } from "@/app/lib/tripleWhale";
import { askDashboard, type AskEvent, type ChatTurn } from "@/app/lib/askDashboard";

// "Ask the dashboard". Streams newline-delimited JSON events so the page can
// show each lookup as it happens: {type:"tool"} lines, then one {type:"answer"}
// or {type:"error"}. Read-only — every tool behind it only reads.
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_TURNS = 30;
const MAX_TURN_CHARS = 20_000;
const MAX_QUESTION_CHARS = 2_000;

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });
}

export async function POST(req: Request) {
  const admin = serviceClient();
  if (!admin) return jsonError("Server is missing the service role key.", 500);

  // Any signed-in member. It reads what the Analytics and Learnings views
  // already show everyone, and costs one Claude run per question.
  const auth = await requireMember(req, admin, null);
  if (!auth.ok) return jsonError(auth.error, auth.status);

  if (!process.env.ANTHROPIC_API_KEY) return jsonError("Server is missing ANTHROPIC_API_KEY.", 500);
  if (activeProvider() !== "triple_whale") {
    return jsonError("Ask the dashboard needs Triple Whale (TRIPLE_WHALE_API_KEY) — it's the only source with new-customer revenue per ad.", 400);
  }

  const body = await req.json().catch(() => null);
  const raw: unknown = body?.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TURNS) {
    return jsonError(`messages must be 1–${MAX_TURNS} turns.`, 400);
  }
  const history: ChatTurn[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as { role?: unknown; content?: unknown };
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (t?.role !== expected || typeof t.content !== "string" || !t.content.trim()) {
      return jsonError("messages must alternate user / assistant, starting with user, each with text.", 400);
    }
    if (t.content.length > MAX_TURN_CHARS) return jsonError("One of the messages is too long.", 400);
    history.push({ role: expected, content: t.content });
  }
  if (history[history.length - 1].role !== "user") return jsonError("The last message must be your question.", 400);
  if (history[history.length - 1].content.length > MAX_QUESTION_CHARS) {
    return jsonError(`Keep the question under ${MAX_QUESTION_CHARS} characters.`, 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AskEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await askDashboard(admin, history, emit);
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "Something went wrong." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

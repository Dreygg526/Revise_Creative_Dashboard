"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, RotateCcw, Search, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAds } from "@/app/hooks/useAds";
import AdDetailModal from "@/app/components/modals/AdDetailModal";
import Markdown from "@/app/components/ask/Markdown";
import type { Ad } from "@/app/types";

// "Ask the dashboard": a chat over the pipeline and its Meta performance,
// answered by /api/ask. The conversation lives in sessionStorage so switching
// views and coming back doesn't lose it; "New chat" clears it.

interface Turn {
  role: "user" | "assistant";
  content: string;
  steps?: string[];                         // the lookups behind an answer
  meta?: { tool_calls: number; cost_usd: number; seconds: number };
  error?: boolean;                          // failed turn: shown, never sent back
}

const STORE_KEY = "ask-dashboard-chat";

// Event-handler timing only; kept out of the component so the purity lint
// rule doesn't read it as a render-time call.
const secondsSince = (t: number) => Math.round((Date.now() - t) / 1000);
const now = () => Date.now();

const SUGGESTIONS = [
  "Which persona had the best NC ROAS last month?",
  "Top 10 briefs by spend in the last 30 days, and which of them are winners?",
  "How has the account's NC ROAS moved week by week over the last 3 months?",
  "Compare Static vs Video Ad performance this year",
  "What did we learn from the gallbladder angle?",
  "How much spend isn't matched to any brief right now?",
];

function loadTurns(): Turn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return [];
  }
}

export default function AskView() {
  const { ads, updateAd, deleteAd } = useAds();
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [openAdId, setOpenAdId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(turns));
    } catch {
      /* private window or storage full — the chat still works, it just won't survive a view switch */
    }
  }, [turns]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, steps]);

  const openAd: Ad | null = openAdId ? ads.find((a) => a.id === openAdId) ?? null : null;

  function openDtc(dtc: number) {
    const ad = ads.find((a) => a.dtc_number === dtc);
    if (ad) {
      setOpenAdId(ad.id);
    } else {
      setNotFound(dtc);
      setTimeout(() => setNotFound(null), 3000);
    }
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;

    // Only completed, successful exchanges go back to the server, so the
    // history always alternates user / assistant.
    const history: { role: "user" | "assistant"; content: string }[] = [];
    for (let i = 0; i + 1 < turns.length; i += 1) {
      const a = turns[i], b = turns[i + 1];
      if (a.role === "user" && b.role === "assistant" && !b.error) {
        history.push({ role: "user", content: a.content }, { role: "assistant", content: b.content });
        i += 1;
      }
    }
    history.push({ role: "user", content: q });

    setTurns((t) => [...t, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    setSteps([]);
    const started = now();
    const controller = new AbortController();
    abortRef.current = controller;
    const collected: string[] = [];

    const finish = (turn: Turn) => {
      setTurns((t) => [...t, { ...turn, steps: collected }]);
      setSteps([]);
      setBusy(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 0);
    };

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "tool") {
            collected.push(e.label);
            setSteps([...collected]);
          } else if (e.type === "answer") {
            finish({
              role: "assistant",
              content: e.text,
              meta: { tool_calls: e.usage.tool_calls, cost_usd: e.usage.cost_usd, seconds: secondsSince(started) },
            });
            return;
          } else if (e.type === "error") {
            throw new Error(e.error);
          }
        }
      }
      throw new Error("The answer was cut off. Try again.");
    } catch (e) {
      const stopped = e instanceof DOMException && e.name === "AbortError";
      finish({
        role: "assistant",
        content: stopped ? "Stopped." : e instanceof Error ? e.message : "Something went wrong.",
        error: true,
      });
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setTurns([]);
    setSteps([]);
    setInput("");
    inputRef.current?.focus();
  }

  const empty = turns.length === 0 && !busy;

  return (
    <div style={{ maxWidth: "860px", margin: "0 auto", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 64px)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "24px" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Ask the dashboard</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
            Questions about briefs, tags and Meta performance, answered from live data. Read-only.
          </p>
        </div>
        {turns.length > 0 && (
          <button
            onClick={newChat}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}
          >
            <RotateCcw size={14} /> New chat
          </button>
        )}
      </div>

      {/* Transcript */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "20px", paddingBottom: "24px" }}>
        {empty && (
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: "10px" }}>
              Try asking
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "8px" }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  style={{ textAlign: "left", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.45, cursor: "pointer", fontFamily: "inherit" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--hover)"; e.currentTarget.style.color = "var(--text)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--card)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  {s}
                </button>
              ))}
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "16px", lineHeight: 1.5 }}>
              Numbers come from Triple Whale (all six ad accounts, Triple Attribution), the same source as the monthly learnings report,
              so they won’t match Ads Manager exactly. Each answer takes 10–40 seconds and costs a few cents.
            </p>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} style={{ alignSelf: "flex-end", maxWidth: "80%", background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "12px", padding: "10px 14px", fontSize: "14px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {t.content}
            </div>
          ) : (
            <div key={i}>
              {t.steps && t.steps.length > 0 && <Steps steps={t.steps} />}
              {t.error ? (
                <div style={{ backgroundColor: "#450a0a", color: "#fca5a5", padding: "10px 14px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px" }}>
                  {t.content}
                </div>
              ) : (
                <Markdown text={t.content} onDtc={openDtc} />
              )}
              {t.meta && (
                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                  {t.meta.tool_calls} lookup{t.meta.tool_calls === 1 ? "" : "s"} · {t.meta.seconds}s · ~${t.meta.cost_usd.toFixed(2)}
                </div>
              )}
            </div>
          )
        )}

        {busy && (
          <div>
            <Steps steps={steps} live />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {notFound != null && (
        <div style={{ position: "fixed", bottom: "96px", left: "50%", transform: "translateX(-50%)", background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", color: "var(--text-secondary)" }}>
          DTC #{notFound} isn’t on the dashboard.
        </div>
      )}

      {/* Composer */}
      <div style={{ position: "sticky", bottom: 0, paddingBottom: "8px", background: "var(--bg)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", border: "1px solid var(--border)", borderRadius: "12px", background: "var(--card)", padding: "8px 8px 8px 14px" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask anything about the briefs and how they performed…"}
            rows={1}
            maxLength={2000}
            style={{ flex: 1, resize: "none", border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: "14px", fontFamily: "inherit", lineHeight: 1.5, padding: "6px 0", maxHeight: "160px", fieldSizing: "content" } as React.CSSProperties}
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.abort()}
              title="Stop"
              style={{ width: "34px", height: "34px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--raised)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => ask(input)}
              disabled={!input.trim()}
              title="Ask"
              style={{ width: "34px", height: "34px", borderRadius: "8px", border: "none", background: input.trim() ? "var(--accent)" : "var(--raised)", color: input.trim() ? "#0d0d0f" : "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() ? "pointer" : "default", flexShrink: 0 }}
            >
              <ArrowUp size={17} strokeWidth={2.25} />
            </button>
          )}
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px", textAlign: "center" }}>
          Enter to send · Shift+Enter for a new line · Click any DTC # to open the brief
        </div>
      </div>

      {openAd && (
        <AdDetailModal
          ad={openAd}
          ads={ads}
          onClose={() => setOpenAdId(null)}
          onSave={async (id, fields) => { await updateAd(id, fields); }}
          onDelete={async (id) => { await deleteAd(id); setOpenAdId(null); }}
        />
      )}
    </div>
  );
}

function Steps({ steps, live = false }: { steps: string[]; live?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
          <Search size={12} style={{ flexShrink: 0 }} />
          <span>{s}</span>
        </div>
      ))}
      {live && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--text-secondary)" }}>
          <Loader2 size={12} className="ask-spin" style={{ flexShrink: 0 }} />
          <span>{steps.length ? "Working it out…" : "Reading the question…"}</span>
        </div>
      )}
    </div>
  );
}

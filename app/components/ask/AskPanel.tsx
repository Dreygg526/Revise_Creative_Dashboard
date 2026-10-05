"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, RotateCcw, Search, Loader2, X, Maximize2, Minimize2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useAds } from "@/app/hooks/useAds";
import AdDetailModal from "@/app/components/modals/AdDetailModal";
import Markdown from "@/app/components/ask/Markdown";
import type { Ad } from "@/app/types";

// "Ask the dashboard": the chat panel that floats above every view, opened
// from the bubble in AskWidget. Answers come from /api/ask. It stays mounted
// while closed, so a question keeps running if you close the panel. The
// conversation also lives in sessionStorage, so a reload doesn't lose it;
// "New chat" clears it.

type FieldValue = string | number | null;

interface ChangeItem {
  ad_id: string;
  dtc: number | null;
  name: string;
  field: string;
  label: string;
  from: FieldValue;
  to: FieldValue;
}

// One batch of edits Claude proposed. "pending" waits on Approve; with
// confirmation off it arrives already "applied". Undo writes `from` back.
interface ChangeCard {
  id: string;
  summary: string;
  items: ChangeItem[];
  skipped: string[];                        // changes the validator refused
  status: "pending" | "applying" | "applied" | "cancelled" | "undone" | "failed";
  message?: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  steps?: string[];                         // the lookups behind an answer
  meta?: { tool_calls: number; cost_usd: number; seconds: number };
  images?: string[];                        // thumbnail URLs the tools returned — the only ones drawn
  changes?: ChangeCard[];
  error?: boolean;                          // failed turn: shown, never sent back
}

const STORE_KEY = "ask-dashboard-chat";
const AUTO_KEY = "ask-dashboard-skip-confirm";

// What Claude sees of an earlier answer's change cards on the next question,
// so "did that go through?" and "undo that" have something to go on.
function changeNote(cards: ChangeCard[] | undefined): string {
  if (!cards?.length) return "";
  const word: Record<ChangeCard["status"], string> = {
    pending: "not reviewed yet (nothing changed)",
    applying: "being applied",
    applied: "approved and applied",
    cancelled: "cancelled by the user (nothing changed)",
    undone: "applied, then undone by the user",
    failed: "failed to apply (nothing changed)",
  };
  return (
    "\n\n[Change cards on this answer: " +
    cards.map((c) => `"${c.summary}" (${c.items.length} change${c.items.length === 1 ? "" : "s"}): ${word[c.status]}`).join("; ") +
    "]"
  );
}

const show = (v: FieldValue) => (v == null || v === "" ? "empty" : String(v));

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

function loadAuto(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(AUTO_KEY) === "1";
  } catch {
    return false;
  }
}

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

export default function AskPanel({
  open, expanded, onClose, onToggleExpand, onAnswer,
}: {
  open: boolean;
  expanded: boolean;
  onClose: () => void;
  onToggleExpand: () => void;
  onAnswer: () => void;          // an answer landed — the bubble shows a dot if the panel is closed
}) {
  const { ads, updateAd, deleteAd, fetchAds } = useAds();
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  // "Skip confirmation" lasts for this chat only; New chat turns it back on.
  const [autoApprove, setAutoApprove] = useState<boolean>(loadAuto);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [openAdId, setOpenAdId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(turns));
    } catch {
      /* private window or storage full — the chat still works, it just won't survive a view switch */
    }
  }, [turns]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(AUTO_KEY, autoApprove ? "1" : "0");
    } catch {
      /* same as above */
    }
  }, [autoApprove]);

  // Scroll the panel, not the page behind it.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, steps, open, expanded]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
        history.push({ role: "user", content: a.content }, { role: "assistant", content: b.content + changeNote(b.changes) });
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
    const cards: ChangeCard[] = [];

    const finish = (turn: Turn) => {
      setTurns((t) => [...t, { ...turn, steps: collected, changes: cards.length ? cards : undefined }]);
      if (cards.some((c) => c.status === "applied")) fetchAds();
      setSteps([]);
      setBusy(false);
      abortRef.current = null;
      onAnswer();
      setTimeout(() => inputRef.current?.focus(), 0);
    };

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ messages: history, auto_approve: autoApprove }),
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
          } else if (e.type === "proposal" || e.type === "applied") {
            cards.push({
              id: e.id,
              summary: e.summary,
              items: e.items,
              skipped: e.errors ?? [],
              // An "applied" event carries items only when the write succeeded.
              status: e.type === "proposal" ? "pending" : e.items.length ? "applied" : "failed",
            });
          } else if (e.type === "answer") {
            finish({
              role: "assistant",
              content: e.text,
              images: e.images,
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

  function setCard(turnIndex: number, cardId: string, patch: Partial<ChangeCard>) {
    setTurns((ts) =>
      ts.map((t, i) => (i !== turnIndex ? t : { ...t, changes: t.changes?.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) }))
    );
  }

  // Approve writes `to` over `from`; Undo writes `from` back over `to`. Both
  // re-validate on the server against the card's current values.
  async function runCard(turnIndex: number, card: ChangeCard, direction: "apply" | "undo") {
    setCard(turnIndex, card.id, { status: "applying", message: undefined });
    try {
      const res = await fetch("/api/ask/apply", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          changes: card.items.map((it) =>
            direction === "apply"
              ? { ad_id: it.ad_id, field: it.field, value: it.to, expected: it.from }
              : { ad_id: it.ad_id, field: it.field, value: it.from, expected: it.to }
          ),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.applied) {
        const msg = (body.errors ?? []).join(" ") || body.error || `Request failed (${res.status}).`;
        setCard(turnIndex, card.id, { status: direction === "apply" ? "pending" : "applied", message: msg });
        return;
      }
      setCard(turnIndex, card.id, { status: direction === "apply" ? "applied" : "undone", message: undefined });
      fetchAds();
    } catch (e) {
      setCard(turnIndex, card.id, { status: direction === "apply" ? "pending" : "applied", message: e instanceof Error ? e.message : "Couldn't reach the server." });
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setAutoApprove(false);
    setTurns([]);
    setSteps([]);
    setInput("");
    inputRef.current?.focus();
  }

  const empty = turns.length === 0 && !busy;
  const iconBtn: React.CSSProperties = {
    width: "30px", height: "30px", borderRadius: "6px", border: "none", background: "transparent", color: "var(--text-secondary)",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
  };

  return (
    <div
      role="dialog"
      aria-label="Ask the dashboard"
      style={{
        position: "fixed", right: "24px", bottom: "88px", zIndex: 40,
        width: expanded ? "min(880px, calc(100vw - 48px))" : "min(420px, calc(100vw - 48px))",
        height: expanded ? "calc(100vh - 112px)" : "min(640px, calc(100vh - 112px))",
        display: open ? "flex" : "none", flexDirection: "column",
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "14px",
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)", overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 10px 10px 16px", borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600 }}>Ask the dashboard</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Live data · changes need your OK</div>
        </div>
        {turns.length > 0 && (
          <button onClick={newChat} title="New chat" style={iconBtn}>
            <RotateCcw size={15} />
          </button>
        )}
        <button onClick={onToggleExpand} title={expanded ? "Make smaller" : "Make bigger"} style={iconBtn}>
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button onClick={onClose} title="Close" style={iconBtn}>
          <X size={17} />
        </button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "18px", position: "relative" }}>
        {empty && (
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: "10px" }}>
              Try asking
            </div>
            <div style={{ display: "grid", gridTemplateColumns: expanded ? "repeat(auto-fill, minmax(240px, 1fr))" : "1fr", gap: "8px" }}>
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
            <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "12px", padding: "9px 13px", fontSize: "14px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
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
                <Markdown text={t.content} onDtc={openDtc} images={t.images} />
              )}
              {t.changes?.map((c) => (
                <ChangeCardView
                  key={c.id}
                  card={c}
                  autoApprove={autoApprove}
                  onApprove={(skipNext) => {
                    if (skipNext) setAutoApprove(true);
                    runCard(i, c, "apply");
                  }}
                  onCancel={() => setCard(i, c.id, { status: "cancelled", message: undefined })}
                  onUndo={() => runCard(i, c, "undo")}
                  onDtc={openDtc}
                />
              ))}
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
      </div>

      {notFound != null && (
        <div style={{ position: "absolute", bottom: "110px", left: "50%", transform: "translateX(-50%)", background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          DTC #{notFound} isn’t on the dashboard.
        </div>
      )}

      {/* Composer */}
      <div style={{ padding: "10px 12px 8px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
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
          {autoApprove ? (
            <>
              <span style={{ color: "#fbbf24" }}>Changes apply without asking in this chat</span>{" "}
              <button
                onClick={() => setAutoApprove(false)}
                style={{ background: "none", border: "none", padding: 0, color: "var(--text-secondary)", textDecoration: "underline", cursor: "pointer", fontSize: "11px", fontFamily: "inherit" }}
              >
                ask me again
              </button>
            </>
          ) : (
            "Enter to send · Click any DTC # to open the brief"
          )}
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

function ChangeCardView({
  card, autoApprove, onApprove, onCancel, onUndo, onDtc,
}: {
  card: ChangeCard;
  autoApprove: boolean;
  onApprove: (skipNext: boolean) => void;
  onCancel: () => void;
  onUndo: () => void;
  onDtc: (dtc: number) => void;
}) {
  const [skipNext, setSkipNext] = useState(false);
  const pending = card.status === "pending";
  const badge: Record<ChangeCard["status"], { text: string; color: string }> = {
    pending: { text: "Waiting for your approval", color: "#fbbf24" },
    applying: { text: "Saving…", color: "var(--text-secondary)" },
    applied: { text: "Applied", color: "#4ade80" },
    cancelled: { text: "Cancelled. Nothing changed", color: "var(--text-muted)" },
    undone: { text: "Undone", color: "var(--text-muted)" },
    failed: { text: "Not applied", color: "#fca5a5" },
  };
  const b = badge[card.status];
  const btn = (primary: boolean): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: "6px", fontSize: "13px", fontWeight: primary ? 600 : 400, cursor: "pointer", fontFamily: "inherit",
    border: primary ? "none" : "1px solid var(--border)",
    background: primary ? "var(--accent)" : "transparent",
    color: primary ? "#0d0d0f" : "var(--text-secondary)",
  });

  return (
    <div style={{ border: `1px solid ${pending ? "#a16207" : "var(--border)"}`, borderRadius: "10px", background: "var(--card)", padding: "12px 14px", margin: "4px 0 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", marginBottom: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600 }}>{card.summary}</div>
        <div style={{ fontSize: "11px", color: b.color, whiteSpace: "nowrap" }}>{b.text}</div>
      </div>

      {card.items.length > 0 && (
        <table style={{ borderCollapse: "collapse", fontSize: "13px" }}>
          <tbody>
            {card.items.map((it, n) => (
              <tr key={n}>
                <td style={{ padding: "4px 8px 4px 0", whiteSpace: "nowrap", verticalAlign: "top" }}>
                  {it.dtc != null ? (
                    <button onClick={() => onDtc(it.dtc!)} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "#7cb4ff", cursor: "pointer" }}>DTC #{it.dtc}</button>
                  ) : it.name}
                </td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)", whiteSpace: "nowrap", verticalAlign: "top" }}>{it.label}</td>
                <td style={{ padding: "4px 0 4px 8px", verticalAlign: "top" }}>
                  <span style={{ color: "var(--text-muted)", textDecoration: card.status === "applied" ? "line-through" : "none" }}>{show(it.from)}</span>
                  <span style={{ color: "var(--text-muted)" }}> → </span>
                  <span style={{ color: "var(--text)" }}>{show(it.to)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {card.skipped.length > 0 && (
        <div style={{ fontSize: "12px", color: "#fca5a5", marginTop: "8px", lineHeight: 1.5 }}>
          {card.status === "failed" ? "" : "Left out: "}{card.skipped.join(" ")}
        </div>
      )}
      {card.message && <div style={{ fontSize: "12px", color: "#fca5a5", marginTop: "8px", lineHeight: 1.5 }}>{card.message}</div>}

      {pending && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
          <button onClick={() => onApprove(skipNext)} style={btn(true)}>Approve {card.items.length > 1 ? `${card.items.length} changes` : "change"}</button>
          <button onClick={onCancel} style={btn(false)}>Cancel</button>
          {!autoApprove && (
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-secondary)", marginLeft: "6px", cursor: "pointer" }}>
              <input type="checkbox" checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)} />
              Don’t ask again in this chat
            </label>
          )}
        </div>
      )}
      {card.status === "applied" && (
        <div style={{ marginTop: "10px" }}>
          <button onClick={onUndo} style={{ ...btn(false), padding: "4px 12px", fontSize: "12px" }}>Undo</button>
        </div>
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

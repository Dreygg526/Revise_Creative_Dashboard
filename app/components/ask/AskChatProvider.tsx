"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAds } from "@/app/hooks/useAds";
import AdDetailModal from "@/app/components/modals/AdDetailModal";
import {
  ATTACH_BUDGET_CHARS, changeNote,
  type Attachment, type ChangeCard, type ChatSummary, type Turn,
} from "@/app/components/ask/chatTypes";

// One conversation shared by everything that shows the chat: the "Ask AI"
// home view, the floating bubble on every other view, and the chat list in
// the sidebar. It lives above the view switch in page.tsx, so a question
// keeps running while you move between views.
//
// Saved chats live in `ask_chats` (ask_chats_schema.sql), one row per
// conversation, readable only by its owner. Without that table the chat still
// works and the current conversation survives a reload via sessionStorage;
// it just isn't listed anywhere.

const SESSION_KEY = "ask-dashboard-current";

// Event-handler timing only; kept out of components so the purity lint rule
// doesn't read it as a render-time call.
const now = () => Date.now();
const secondsSince = (t: number) => Math.round((Date.now() - t) / 1000);
const newId = () => crypto.randomUUID();

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

interface SessionState {
  chatId: string | null;
  turns: Turn[];
  autoApprove: boolean;
}

function loadSession(): SessionState {
  const empty = { chatId: null, turns: [], autoApprove: false };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as SessionState) } : empty;
  } catch {
    return empty;
  }
}

// sessionStorage holds ~5MB; attachment bytes go to the database copy only.
const stripAttachments = (turns: Turn[]): Turn[] =>
  turns.map((t) => (t.attachments ? { ...t, attachments: t.attachments.map((a) => ({ ...a, data: "" })) } : t));

// What gets sent: completed exchanges only (so roles alternate), each answer
// with a note about its change cards, attachments newest-first until the
// request budget runs out.
function buildHistory(turns: Turn[], question: string, attachments: Attachment[]) {
  const pairs: { role: "user" | "assistant"; content: string; attachments?: Attachment[] }[] = [];
  for (let i = 0; i + 1 < turns.length; i += 1) {
    const a = turns[i], b = turns[i + 1];
    if (a.role === "user" && b.role === "assistant" && !b.error) {
      pairs.push({ role: "user", content: a.content, attachments: a.attachments }, { role: "assistant", content: b.content + changeNote(b.changes) });
      i += 1;
    }
  }
  pairs.push({ role: "user", content: question, attachments });

  let budget = ATTACH_BUDGET_CHARS;
  let count = 0;
  for (let i = pairs.length - 1; i >= 0; i--) {
    const p = pairs[i];
    if (!p.attachments?.length) { delete p.attachments; continue; }
    const kept: Attachment[] = [];
    const dropped: string[] = [];
    for (const a of p.attachments) {
      if (a.data && a.data.length <= budget && count < 8) { kept.push(a); budget -= a.data.length; count++; }
      else dropped.push(a.name);
    }
    if (dropped.length) p.content += `\n\n[Earlier attachment not re-sent: ${dropped.join(", ")}]`;
    if (kept.length) p.attachments = kept; else delete p.attachments;
  }
  return pairs;
}

interface AskChat {
  turns: Turn[];
  busy: boolean;
  steps: string[];
  autoApprove: boolean;
  setAutoApprove: (v: boolean) => void;
  draft: string;
  setDraft: (v: string) => void;
  chatId: string | null;
  chats: ChatSummary[];
  historyAvailable: boolean | null;   // null = still checking
  answerTick: number;                  // bumps on every finished answer (unread dot)
  ask: (question: string, attachments?: Attachment[]) => void;
  stop: () => void;
  newChat: () => void;
  openChat: (id: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  approveCard: (turnIndex: number, card: ChangeCard, skipNext: boolean) => void;
  cancelCard: (turnIndex: number, cardId: string) => void;
  undoCard: (turnIndex: number, card: ChangeCard) => void;
  openDtc: (dtc: number) => void;
}

const Ctx = createContext<AskChat | null>(null);

export function useAskChat(): AskChat {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAskChat must be used inside AskChatProvider");
  return v;
}

export default function AskChatProvider({ children }: { children: ReactNode }) {
  const { ads, updateAd, deleteAd, fetchAds } = useAds();
  const [initial] = useState(loadSession);
  const [turns, setTurns] = useState<Turn[]>(initial.turns);
  const [chatId, setChatId] = useState<string | null>(initial.chatId);
  const [autoApprove, setAutoApprove] = useState(initial.autoApprove);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [historyAvailable, setHistoryAvailable] = useState<boolean | null>(null);
  const [answerTick, setAnswerTick] = useState(0);
  const [openAdId, setOpenAdId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Attachment bytes don't survive sessionStorage; this keeps them for the
  // open chat so a follow-up can still send them.
  const turnsRef = useRef<Turn[]>(initial.turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // ---- Chat list ----------------------------------------------------------
  const refreshChats = useCallback(async () => {
    const { data, error } = await supabase
      .from("ask_chats")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(40);
    if (error) {
      setHistoryAvailable(false);
      return;
    }
    setHistoryAvailable(true);
    setChats((data ?? []) as ChatSummary[]);
  }, []);

  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  // ---- Persistence --------------------------------------------------------
  useEffect(() => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ chatId, turns: stripAttachments(turns), autoApprove }));
    } catch {
      /* private window or storage full: the chat works, it just won't survive a reload */
    }
  }, [chatId, turns, autoApprove]);

  // Save to ask_chats shortly after anything changes. Not while an answer is
  // streaming: the half-finished turn would be saved and then saved again.
  useEffect(() => {
    if (!historyAvailable || !chatId || busy || !turns.length) return;
    const t = setTimeout(async () => {
      const { data: s } = await supabase.auth.getSession();
      const email = s.session?.user.email;
      if (!email) return;
      const first = turns.find((x) => x.role === "user")?.content ?? "New chat";
      const title = first.length > 80 ? first.slice(0, 77) + "…" : first;
      const { error } = await supabase.from("ask_chats").upsert({
        id: chatId,
        owner_email: email,
        title,
        turns,
        auto_approve: autoApprove,
        updated_at: new Date().toISOString(),
      });
      if (!error) refreshChats();
    }, 600);
    return () => clearTimeout(t);
  }, [historyAvailable, chatId, busy, turns, autoApprove, refreshChats]);

  // ---- Asking -------------------------------------------------------------
  const ask = useCallback(
    async (question: string, attachments: Attachment[] = []) => {
      const q = question.trim();
      if ((!q && !attachments.length) || abortRef.current) return;
      const text = q || "What can you tell me about this?";

      const history = buildHistory(turnsRef.current, text, attachments);
      if (!chatId) setChatId(newId());
      setTurns((t) => [...t, { role: "user", content: text, attachments: attachments.length ? attachments : undefined }]);
      setDraft("");
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
        setAnswerTick((n) => n + 1);
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
          throw new Error(body?.error || (res.status === 413 ? "The attachments are too big. Try fewer or smaller files." : `Request failed (${res.status}).`));
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
        finish({ role: "assistant", content: stopped ? "Stopped." : e instanceof Error ? e.message : "Something went wrong.", error: true });
      }
    },
    [autoApprove, chatId, fetchAds]
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setChatId(null);
    setTurns([]);
    setSteps([]);
    setDraft("");
    setAutoApprove(false);
  }, []);

  const openChat = useCallback(async (id: string) => {
    if (abortRef.current) abortRef.current.abort();
    const { data, error } = await supabase.from("ask_chats").select("id, turns, auto_approve").eq("id", id).maybeSingle();
    if (error || !data) return;
    setChatId(data.id);
    setTurns((data.turns ?? []) as Turn[]);
    setAutoApprove(!!data.auto_approve);
    setSteps([]);
  }, []);

  const deleteChat = useCallback(
    async (id: string) => {
      await supabase.from("ask_chats").delete().eq("id", id);
      if (id === chatId) newChat();
      refreshChats();
    },
    [chatId, newChat, refreshChats]
  );

  // ---- Change cards -------------------------------------------------------
  const setCard = useCallback((turnIndex: number, cardId: string, patch: Partial<ChangeCard>) => {
    setTurns((ts) => ts.map((t, i) => (i !== turnIndex ? t : { ...t, changes: t.changes?.map((c) => (c.id === cardId ? { ...c, ...patch } : c)) })));
  }, []);

  // Approve writes `to` over `from`; Undo writes `from` back over `to`. Both
  // re-validate on the server against the card's current values.
  const runCard = useCallback(
    async (turnIndex: number, card: ChangeCard, direction: "apply" | "undo") => {
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
    },
    [setCard, fetchAds]
  );

  const approveCard = useCallback(
    (turnIndex: number, card: ChangeCard, skipNext: boolean) => {
      if (skipNext) setAutoApprove(true);
      runCard(turnIndex, card, "apply");
    },
    [runCard]
  );
  const undoCard = useCallback((turnIndex: number, card: ChangeCard) => runCard(turnIndex, card, "undo"), [runCard]);
  const cancelCard = useCallback((turnIndex: number, cardId: string) => setCard(turnIndex, cardId, { status: "cancelled", message: undefined }), [setCard]);

  // ---- Briefs -------------------------------------------------------------
  const openDtc = useCallback(
    (dtc: number) => {
      const ad = ads.find((a) => a.dtc_number === dtc);
      if (ad) setOpenAdId(ad.id);
      else {
        setNotFound(dtc);
        setTimeout(() => setNotFound(null), 3000);
      }
    },
    [ads]
  );
  const openAd = openAdId ? ads.find((a) => a.id === openAdId) ?? null : null;

  const value: AskChat = {
    turns, busy, steps, autoApprove, setAutoApprove, draft, setDraft, chatId, chats, historyAvailable, answerTick,
    ask, stop, newChat, openChat, deleteChat, approveCard, cancelCard, undoCard, openDtc,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {notFound != null && (
        <div style={{ position: "fixed", bottom: "96px", left: "50%", transform: "translateX(-50%)", zIndex: 45, background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 14px", fontSize: "13px", color: "var(--text-secondary)" }}>
          DTC #{notFound} isn’t on the dashboard.
        </div>
      )}
      {openAd && (
        <AdDetailModal
          ad={openAd}
          ads={ads}
          onClose={() => setOpenAdId(null)}
          onSave={async (id, fields) => { await updateAd(id, fields); }}
          onDelete={async (id) => { await deleteAd(id); setOpenAdId(null); }}
        />
      )}
    </Ctx.Provider>
  );
}

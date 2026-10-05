"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, LayoutGrid, Palette, TrendingUp, KanbanSquare, FileText, PenLine, RotateCcw, ArrowUpRight } from "lucide-react";
import { useAskChat } from "@/app/components/ask/AskChatProvider";
import ChatThread from "@/app/components/ask/ChatThread";
import Composer from "@/app/components/ask/Composer";

// The dashboard's home screen: Moby's layout (a big centered "ask anything"
// box over a "Get inspired" prompt gallery), in this app's dark theme. Once a
// conversation starts it becomes a chat with the input docked at the bottom.

const CATEGORIES = [
  { key: "all", label: "All", icon: LayoutGrid, accent: "#9ca3af" },
  { key: "creative", label: "Creative", icon: Palette, accent: "#d95926" },
  { key: "performance", label: "Performance", icon: TrendingUp, accent: "#3987e5" },
  { key: "pipeline", label: "Pipeline", icon: KanbanSquare, accent: "#199e70" },
  { key: "reports", label: "Reports", icon: FileText, accent: "#c98500" },
  { key: "changes", label: "Make changes", icon: PenLine, accent: "#a78bfa" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

const PROMPTS: Record<Exclude<CategoryKey, "all">, { title: string; prompt: string }[]> = {
  creative: [
    { title: "What winners have in common", prompt: "Look at the creatives of last month's top 3 winning briefs and tell me what they have in common visually." },
    { title: "Best vs worst creative", prompt: "Show me the creatives of last month's best and worst brief by NC ROAS and explain the differences." },
    { title: "Compare a competitor ad", prompt: "I'm attaching a competitor's ad. How does it compare to our current winners, and what could we borrow?" },
    { title: "Top spenders this week", prompt: "Show me the thumbnails of the 5 briefs that spent the most in the last 7 days, with their NC ROAS." },
  ],
  performance: [
    { title: "Best persona last month", prompt: "Which persona had the best NC ROAS last month?" },
    { title: "Top 10 by spend", prompt: "Top 10 briefs by spend in the last 30 days, and which of them are winners?" },
    { title: "NC ROAS trend", prompt: "How has the account's NC ROAS moved week by week over the last 3 months? Show a chart." },
    { title: "Static vs video", prompt: "Compare Static vs Video Ad performance this year, with Meta's numbers next to the pixel's." },
  ],
  pipeline: [
    { title: "Close to the winner line", prompt: "Which briefs in Testing are closest to the winner line, and how much more spend would settle them?" },
    { title: "Testing but not spending", prompt: "Which briefs in Testing haven't spent anything in the last 14 days?" },
    { title: "What's in Review", prompt: "What's in Review right now, and who is the strategist and editor on each?" },
    { title: "Briefs per strategist", prompt: "How many briefs did each strategist create this month, and how are they doing?" },
  ],
  reports: [
    { title: "Last month's learnings", prompt: "Summarize last month's learnings report in 5 bullet points." },
    { title: "What to brief next", prompt: "Based on what's winning, what should we brief next month? Give me 3 concrete ideas." },
    { title: "Unmatched spend", prompt: "How much spend isn't matched to any brief right now, and which DTC numbers are missing?" },
    { title: "Month vs month", prompt: "Compare August and September launches: count, spend, win rate and NC ROAS." },
  ],
  changes: [
    { title: "Tag a concept", prompt: "Tag DTC #138 and DTC #139 with the concept Before/After." },
    { title: "Raise priority on winners", prompt: "Set priority to High on every brief in Testing above 1.2 NC ROAS over the last 30 days." },
    { title: "Assign me", prompt: "Assign me as strategist on DTC #" },
    { title: "Write a learning", prompt: "Draft a learning for DTC #174 from its numbers and creatives, and put it on the card." },
  ],
};

export default function AskHome() {
  const { turns, busy, newChat, setDraft } = useAskChat();
  const [cat, setCat] = useState<CategoryKey>("all");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const started = turns.length > 0 || busy;

  useEffect(() => {
    if (started) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [started, turns.length, busy]);

  const shown =
    cat === "all"
      ? (Object.keys(PROMPTS) as (keyof typeof PROMPTS)[]).flatMap((k) => PROMPTS[k].slice(0, k === "performance" || k === "reports" ? 3 : 2).map((p) => ({ ...p, cat: k })))  // 12 cards: full rows of 3
      : PROMPTS[cat].map((p) => ({ ...p, cat }));

  if (started) {
    return (
      <div style={{ maxWidth: "820px", margin: "0 auto", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 64px)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Logo size={28} />
            <span style={{ fontSize: "15px", fontWeight: 600 }}>Ask AI</span>
          </div>
          <button
            onClick={newChat}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: "13px", cursor: "pointer", fontFamily: "inherit" }}
          >
            <RotateCcw size={14} /> New chat
          </button>
        </div>
        <div style={{ flex: 1, paddingBottom: "24px" }}>
          <ChatThread />
          <div ref={bottomRef} />
        </div>
        <div style={{ position: "sticky", bottom: 0, background: "var(--bg)", paddingBottom: "16px", paddingTop: "8px" }}>
          <Composer variant="dock" autoFocus />
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "8px", textAlign: "center" }}>
            Live data from Triple Whale · click any DTC # to open the brief · the AI can be wrong, check numbers that matter
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1080px", margin: "0 auto" }}>
      {/* Hero */}
      <div style={{ maxWidth: "720px", margin: "0 auto", paddingTop: "9vh", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "18px" }}>
          <Logo size={52} />
        </div>
        <h1 style={{ fontSize: "30px", fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>What do you want to know?</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: "10px 0 26px" }}>
          Briefs, creatives and Meta performance, answered from live data. It can make changes too, after you approve them.
        </p>
        <div style={{ textAlign: "left" }}>
          <Composer variant="hero" autoFocus />
        </div>
      </div>

      {/* Get inspired */}
      <div style={{ marginTop: "56px", border: "1px solid var(--border)", borderRadius: "18px", background: "var(--card)", padding: "24px" }}>
        <div style={{ fontSize: "17px", fontWeight: 600, marginBottom: "16px" }}>Get inspired</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px", marginBottom: "22px" }}>
          {CATEGORIES.map((c) => {
            const active = cat === c.key;
            const Icon = c.icon;
            return (
              <button
                key={c.key}
                onClick={() => setCat(c.key)}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "26px", padding: "14px",
                  borderRadius: "12px", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  border: `1px solid ${active ? c.accent : "var(--border)"}`,
                  background: active ? `color-mix(in srgb, ${c.accent} 12%, var(--nested))` : "var(--nested)",
                  transition: "border-color 0.12s, background-color 0.12s",
                }}
              >
                <span style={{ width: "34px", height: "34px", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", background: `color-mix(in srgb, ${c.accent} 22%, transparent)`, color: c.accent }}>
                  <Icon size={18} />
                </span>
                <span style={{ fontSize: "13px", fontWeight: active ? 600 : 500, color: active ? "var(--text)" : "var(--text-secondary)" }}>{c.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "10px" }}>
          {shown.map((p) => {
            const c = CATEGORIES.find((x) => x.key === p.cat)!;
            return (
              <button
                key={p.prompt}
                onClick={() => {
                  setDraft(p.prompt);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                  document.querySelector<HTMLTextAreaElement>("textarea")?.focus();
                }}
                style={{ display: "flex", gap: "12px", alignItems: "flex-start", textAlign: "left", padding: "14px", borderRadius: "12px", border: "1px solid var(--border)", background: "var(--nested)", cursor: "pointer", fontFamily: "inherit" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--nested)"; }}
              >
                <span style={{ width: "4px", alignSelf: "stretch", borderRadius: "2px", background: c.accent, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "4px" }}>{p.title}</span>
                  <span style={{ display: "block", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.45 }}>{p.prompt}</span>
                </span>
                <ArrowUpRight size={14} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: "2px" }} />
              </button>
            );
          })}
        </div>
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", margin: "18px 0 8px" }}>
        Numbers come from Triple Whale: the team’s pixel figures, with Meta’s own numbers alongside. Answers take 10–40 seconds and cost a few cents.
      </p>
    </div>
  );
}

export function Logo({ size }: { size: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: size * 0.28, display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #3987e5 0%, #199e70 100%)", color: "#fff", flexShrink: 0,
        boxShadow: size > 40 ? "0 8px 28px rgba(57,135,229,0.35)" : "none",
      }}
    >
      <Sparkles size={size * 0.5} strokeWidth={2} />
    </span>
  );
}

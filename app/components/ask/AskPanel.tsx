"use client";

import { useEffect, useRef } from "react";
import { RotateCcw, X, Maximize2 } from "lucide-react";
import { useAskChat } from "@/app/components/ask/AskChatProvider";
import ChatThread from "@/app/components/ask/ChatThread";
import Composer from "@/app/components/ask/Composer";
import { Logo } from "@/app/components/ask/AskHome";

// The chat panel the floating bubble opens on every view except the Ask AI
// home. Same conversation as the home view (AskChatProvider), smaller frame.
// Hidden with display:none rather than unmounted, so its scroll position and
// half-typed attachments survive closing it.
export default function AskPanel({ open, onClose, onOpenFull }: { open: boolean; onClose: () => void; onOpenFull: () => void }) {
  const { turns, busy, steps, newChat, setDraft } = useAskChat();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Scroll the panel, not the page behind it.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, steps, open]);

  const iconBtn: React.CSSProperties = {
    width: "30px", height: "30px", borderRadius: "6px", border: "none", background: "transparent", color: "var(--text-secondary)",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
  };
  const empty = turns.length === 0 && !busy;

  return (
    <div
      role="dialog"
      aria-label="Ask AI"
      style={{
        position: "fixed", right: "24px", bottom: "88px", zIndex: 40,
        width: "min(420px, calc(100vw - 48px))", height: "min(640px, calc(100vh - 112px))",
        display: open ? "flex" : "none", flexDirection: "column",
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "14px",
        boxShadow: "0 18px 50px rgba(0,0,0,0.55)", overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 10px 10px 14px", borderBottom: "1px solid var(--border)", background: "var(--card)" }}>
        <Logo size={26} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600 }}>Ask AI</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Live data · changes need your OK</div>
        </div>
        {turns.length > 0 && (
          <button onClick={newChat} title="New chat" style={iconBtn}><RotateCcw size={15} /></button>
        )}
        <button onClick={onOpenFull} title="Open full page" style={iconBtn}><Maximize2 size={15} /></button>
        <button onClick={onClose} title="Close" style={iconBtn}><X size={17} /></button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {empty ? (
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: "10px" }}>
              Try asking
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                "Which persona had the best NC ROAS last month?",
                "Top 10 briefs by spend in the last 30 days, and which are winners?",
                "Which briefs in Testing are closest to the winner line?",
                "How much spend isn't matched to any brief right now?",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setDraft(s)}
                  style={{ textAlign: "left", padding: "11px 13px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)", color: "var(--text-secondary)", fontSize: "13px", lineHeight: 1.45, cursor: "pointer", fontFamily: "inherit" }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--hover)"; e.currentTarget.style.color = "var(--text)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--card)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ChatThread compact />
        )}
      </div>

      <div style={{ padding: "10px 12px 12px", borderTop: "1px solid var(--border)" }}>
        <Composer variant="compact" autoFocus={open} />
      </div>
    </div>
  );
}

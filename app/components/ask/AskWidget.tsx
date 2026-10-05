"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";
import AskPanel from "@/app/components/ask/AskPanel";
import { useAskChat } from "@/app/components/ask/AskChatProvider";

// The floating chat bubble, bottom-right on every view except the Ask AI
// home (which is the same chat, full size). Layer 40 keeps it under the ad
// card (50) and its sub-modals (60), so a brief opened from the chat lands on
// top. A dot marks an answer that arrived while the panel was closed.
export default function AskWidget({ hidden, onOpenFull }: { hidden: boolean; onOpenFull: () => void }) {
  const { answerTick } = useAskChat();
  const [open, setOpen] = useState(false);
  const [seenTick, setSeenTick] = useState(answerTick);
  const unread = !open && answerTick > seenTick;

  if (hidden) return null;

  return (
    <>
      <AskPanel
        open={open}
        onClose={() => { setOpen(false); setSeenTick(answerTick); }}
        onOpenFull={() => { setOpen(false); setSeenTick(answerTick); onOpenFull(); }}
      />
      <button
        onClick={() => { setOpen(!open); setSeenTick(answerTick); }}
        title={open ? "Close chat" : "Ask AI"}
        aria-label={open ? "Close chat" : "Ask AI"}
        style={{
          position: "fixed", right: "24px", bottom: "24px", zIndex: 40,
          width: "52px", height: "52px", borderRadius: "50%",
          border: "1px solid var(--border)", background: open ? "var(--raised)" : "var(--accent)",
          color: open ? "var(--text)" : "#0d0d0f",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          boxShadow: "0 8px 24px rgba(0,0,0,0.45)", transition: "transform 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.06)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      >
        {open ? <X size={22} /> : <MessageCircle size={23} strokeWidth={2} />}
        {unread && (
          <span style={{ position: "absolute", top: "2px", right: "2px", width: "12px", height: "12px", borderRadius: "50%", background: "#3987e5", border: "2px solid var(--bg)" }} />
        )}
      </button>
    </>
  );
}

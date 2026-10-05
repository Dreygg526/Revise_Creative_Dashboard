"use client";

import { useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import AskPanel from "@/app/components/ask/AskPanel";

// The floating "Ask the dashboard" bubble, bottom-right on every view.
// The panel (and the ads fetch inside it) isn't mounted until the first
// open, so people who never use the chat don't pay for it on page load.
// Layer 40 keeps it under the ad card (50) and its sub-modals (60), so a
// brief opened from the chat appears on top of it.
export default function AskWidget() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(false);
  // An answer can land long after the question was sent, from a callback
  // created back then; the ref is how it sees whether the panel is open *now*.
  const openRef = useRef(false);

  function setPanel(next: boolean) {
    openRef.current = next;
    setOpen(next);
    if (next) {
      setEverOpened(true);
      setUnread(false);
    }
  }

  return (
    <>
      {everOpened && (
        <AskPanel
          open={open}
          expanded={expanded}
          onClose={() => setPanel(false)}
          onToggleExpand={() => setExpanded((e) => !e)}
          onAnswer={() => { if (!openRef.current) setUnread(true); }}
        />
      )}
      <button
        onClick={() => setPanel(!open)}
        title={open ? "Close chat" : "Ask the dashboard"}
        aria-label={open ? "Close chat" : "Ask the dashboard"}
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
        {unread && !open && (
          <span style={{ position: "absolute", top: "2px", right: "2px", width: "12px", height: "12px", borderRadius: "50%", background: "#3987e5", border: "2px solid var(--bg)" }} />
        )}
      </button>
    </>
  );
}

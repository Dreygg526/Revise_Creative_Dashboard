"use client";

import { useState } from "react";
import { Plus, Trash2, MessageSquare } from "lucide-react";
import { useAskChat } from "@/app/components/ask/AskChatProvider";

// Moby's "Chat History", as a list in the sidebar: the person's own saved
// conversations, newest first. Opening one switches to the Ask AI view.
export default function RecentChats({ onOpen, activeHome }: { onOpen: () => void; activeHome: boolean }) {
  const { chats, chatId, openChat, deleteChat, newChat, historyAvailable } = useAskChat();
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? chats : chats.slice(0, 8);

  return (
    // Shrinks to fit the pinned sidebar; the list below scrolls on its own.
    <div style={{ marginTop: "18px", display: "flex", flexDirection: "column", minHeight: 0, flex: "0 1 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px 6px" }}>
        <span style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>Chats</span>
        <button
          onClick={() => { newChat(); onOpen(); }}
          title="New chat"
          style={{ display: "flex", alignItems: "center", gap: "4px", border: "none", background: "transparent", color: "var(--text-secondary)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", padding: "2px 4px", borderRadius: "4px" }}
        >
          <Plus size={13} /> New
        </button>
      </div>

      {historyAvailable === false && (
        <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "2px 12px", lineHeight: 1.45 }}>
          Chat history isn’t switched on yet. Your current chat still works.
        </div>
      )}
      {historyAvailable && chats.length === 0 && (
        <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "2px 12px" }}>Your chats will show up here.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1px", overflowY: "auto" }} className="column-scroll">
        {list.map((c) => {
          const active = activeHome && c.id === chatId;
          return (
            <div
              key={c.id}
              className="ask-chat-row"
              style={{ display: "flex", alignItems: "center", borderRadius: "8px", background: active ? "var(--raised)" : "transparent" }}
            >
              <button
                onClick={() => { openChat(c.id); onOpen(); }}
                title={c.title}
                style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px", padding: "6px 4px 6px 12px", border: "none", background: "transparent", color: active ? "var(--text)" : "var(--text-secondary)", fontSize: "13px", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
              >
                <MessageSquare size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
              </button>
              <button
                onClick={() => deleteChat(c.id)}
                title="Delete chat"
                className="ask-chat-delete"
                style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", padding: "6px 8px", display: "flex" }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
      {chats.length > 8 && (
        <button
          onClick={() => setShowAll((s) => !s)}
          style={{ border: "none", background: "transparent", color: "var(--text-muted)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: "6px 12px" }}
        >
          {showAll ? "Show less" : `Show all ${chats.length}`}
        </button>
      )}
    </div>
  );
}

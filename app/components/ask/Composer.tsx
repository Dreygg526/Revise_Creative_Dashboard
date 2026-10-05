"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Plus, Paperclip, ShieldCheck, Zap, ChevronDown, Sparkles, Check } from "lucide-react";
import { useAskChat } from "@/app/components/ask/AskChatProvider";
import { AttachmentStrip } from "@/app/components/ask/ChatThread";
import { prepareAttachment, type Attachment } from "@/app/components/ask/chatTypes";

const MAX_FILES = 4;

// The input box. "hero" is the big centered box on the empty home screen,
// "dock" sits under a conversation on the home view, "compact" is the bubble.
export default function Composer({ variant, autoFocus = false }: { variant: "hero" | "dock" | "compact"; autoFocus?: boolean }) {
  const { draft, setDraft, ask, busy, stop, autoApprove, setAutoApprove, turns } = useAskChat();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [menu, setMenu] = useState<"attach" | "approve" | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const big = variant === "hero";

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Close a popover on any click outside it.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  async function addFiles(list: FileList | File[]) {
    setFileError(null);
    const incoming = Array.from(list).slice(0, MAX_FILES - files.length);
    if (Array.from(list).length > incoming.length) setFileError(`Up to ${MAX_FILES} files per question.`);
    const out: Attachment[] = [];
    for (const f of incoming) {
      const a = await prepareAttachment(f);
      if ("error" in a) setFileError(a.error);
      else out.push(a);
    }
    if (out.length) setFiles((prev) => [...prev, ...out].slice(0, MAX_FILES));
  }

  function send() {
    if (busy || (!draft.trim() && !files.length)) return;
    ask(draft, files);
    setFiles([]);
    setFileError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const canSend = !busy && (!!draft.trim() || files.length > 0);
  const chip: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "6px", height: "30px", padding: "0 10px", borderRadius: "999px",
    border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)",
    fontSize: "12px", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
  };
  const menuBox: React.CSSProperties = {
    position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 5, minWidth: "230px",
    background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "10px", padding: "6px",
    boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
  };
  const menuItem: React.CSSProperties = {
    display: "flex", alignItems: "flex-start", gap: "10px", width: "100%", textAlign: "left", padding: "8px 10px",
    borderRadius: "6px", border: "none", background: "transparent", color: "var(--text)", fontSize: "13px",
    cursor: "pointer", fontFamily: "inherit",
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        style={{
          border: `1px solid ${dragging ? "#3987e5" : "var(--border)"}`, borderRadius: big ? "18px" : "14px",
          background: "var(--card)", padding: big ? "16px 16px 12px" : "10px 10px 8px",
          boxShadow: big ? "0 10px 40px rgba(0,0,0,0.35)" : "none", transition: "border-color 0.12s",
        }}
      >
        {files.length > 0 && (
          <div style={{ marginBottom: "10px" }}>
            <AttachmentStrip attachments={files} onRemove={(i) => setFiles((f) => f.filter((_, n) => n !== i))} />
          </div>
        )}
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) { e.preventDefault(); addFiles(pasted); }
          }}
          placeholder={turns.length ? "Ask a follow-up…" : "Ask anything about your briefs, creatives and performance…"}
          rows={1}
          maxLength={2000}
          style={{
            width: "100%", resize: "none", border: "none", outline: "none", background: "transparent", color: "var(--text)",
            fontSize: big ? "16px" : "14px", fontFamily: "inherit", lineHeight: 1.5, padding: big ? "2px 4px 10px" : "4px 4px 8px",
            minHeight: big ? "52px" : "24px", maxHeight: "200px", fieldSizing: "content", boxSizing: "border-box",
          } as React.CSSProperties}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {/* + menu */}
          <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setMenu(menu === "attach" ? null : "attach")} title="Add context" style={{ ...chip, width: "30px", padding: 0, justifyContent: "center" }}>
              <Plus size={16} />
            </button>
            {menu === "attach" && (
              <div style={menuBox}>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "4px 10px 6px" }}>Add context</div>
                <button style={menuItem} onClick={() => { setMenu(null); fileRef.current?.click(); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <Paperclip size={15} style={{ marginTop: "2px", color: "var(--text-secondary)" }} />
                  <span>Attach image or PDF<div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>Screenshots, competitor ads, briefs</div></span>
                </button>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "6px 10px 4px", borderTop: "1px solid var(--border)", marginTop: "4px" }}>
                  Tip: paste a screenshot with Ctrl+V, or drop files on the box.
                </div>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />

          {/* Approval mode — Moby's "Ask every time" */}
          <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setMenu(menu === "approve" ? null : "approve")} style={{ ...chip, color: autoApprove ? "#fbbf24" : "var(--text-secondary)" }}>
              {autoApprove ? <Zap size={13} /> : <ShieldCheck size={13} />}
              {variant === "compact" ? (autoApprove ? "Auto" : "Ask first") : autoApprove ? "Apply changes directly" : "Ask before changes"}
              <ChevronDown size={12} />
            </button>
            {menu === "approve" && (
              <div style={menuBox}>
                <div style={{ fontSize: "11px", color: "var(--text-muted)", padding: "4px 10px 6px" }}>When the AI wants to change a card</div>
                {[
                  { on: false, icon: ShieldCheck, label: "Ask before changes", hint: "Show an approval card first (recommended)" },
                  { on: true, icon: Zap, label: "Apply changes directly", hint: "For this chat only; every change can be undone" },
                ].map((o) => (
                  <button key={o.label} style={menuItem} onClick={() => { setAutoApprove(o.on); setMenu(null); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <o.icon size={15} style={{ marginTop: "2px", color: o.on ? "#fbbf24" : "var(--text-secondary)" }} />
                    <span style={{ flex: 1 }}>{o.label}<div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>{o.hint}</div></span>
                    {autoApprove === o.on && <Check size={14} style={{ marginTop: "2px" }} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ flex: 1 }} />
          {variant !== "compact" && (
            <div style={{ ...chip, cursor: "default", border: "none", color: "var(--text-muted)" }} title="Answers come from Claude Opus 5.5">
              <Sparkles size={13} /> Opus 5.5
            </div>
          )}
          {busy ? (
            <button onClick={stop} title="Stop" style={{ width: "34px", height: "34px", borderRadius: "10px", border: "1px solid var(--border)", background: "var(--raised)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button onClick={send} disabled={!canSend} title="Ask"
              style={{ width: "34px", height: "34px", borderRadius: "10px", border: "none", background: canSend ? "var(--accent)" : "var(--raised)", color: canSend ? "#0d0d0f" : "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: canSend ? "pointer" : "default" }}>
              <ArrowUp size={17} strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
      {fileError && <div style={{ fontSize: "12px", color: "#fca5a5", marginTop: "6px" }}>{fileError}</div>}
    </div>
  );
}

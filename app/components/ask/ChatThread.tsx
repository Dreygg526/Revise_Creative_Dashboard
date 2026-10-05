"use client";

import { useState } from "react";
import { Search, Loader2, FileText } from "lucide-react";
import Markdown from "@/app/components/ask/Markdown";
import { useAskChat } from "@/app/components/ask/AskChatProvider";
import { attachmentSrc, showValue as show, type Attachment, type ChangeCard } from "@/app/components/ask/chatTypes";

// The conversation itself: questions, lookups, answers (with images and
// charts), change cards. Shared by the home view and the bubble panel.
export default function ChatThread({ compact = false }: { compact?: boolean }) {
  const { turns, busy, steps, autoApprove, approveCard, cancelCard, undoCard, openDtc } = useAskChat();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? "18px" : "26px" }}>
      {turns.map((t, i) =>
        t.role === "user" ? (
          <div key={i} style={{ alignSelf: "flex-end", maxWidth: compact ? "85%" : "75%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
            {t.attachments?.length ? <AttachmentStrip attachments={t.attachments} /> : null}
            <div style={{ background: "var(--raised)", border: "1px solid var(--border)", borderRadius: "14px", padding: "9px 14px", fontSize: "14px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {t.content}
            </div>
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
                onApprove={(skipNext) => approveCard(i, c, skipNext)}
                onCancel={() => cancelCard(i, c.id)}
                onUndo={() => undoCard(i, c)}
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
      {busy && <Steps steps={steps} live />}
    </div>
  );
}

export function AttachmentStrip({ attachments, onRemove }: { attachments: Attachment[]; onRemove?: (i: number) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: onRemove ? "flex-start" : "flex-end" }}>
      {attachments.map((a, i) => (
        <div key={i} style={{ position: "relative" }} title={a.name}>
          {a.media_type === "application/pdf" || !a.data ? (
            <div style={{ height: "56px", minWidth: "56px", maxWidth: "180px", display: "flex", alignItems: "center", gap: "6px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)", fontSize: "12px", color: "var(--text-secondary)" }}>
              <FileText size={16} style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
            <img src={attachmentSrc(a)} alt={a.name} style={{ width: "56px", height: "56px", objectFit: "cover", borderRadius: "8px", border: "1px solid var(--border)", display: "block" }} />
          )}
          {onRemove && (
            <button
              onClick={() => onRemove(i)}
              title="Remove"
              style={{ position: "absolute", top: "-6px", right: "-6px", width: "18px", height: "18px", borderRadius: "50%", border: "1px solid var(--border)", background: "var(--raised)", color: "var(--text)", fontSize: "11px", lineHeight: "15px", cursor: "pointer", padding: 0 }}
            >
              ×
            </button>
          )}
        </div>
      ))}
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

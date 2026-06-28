"use client";

import { useState } from "react";
import { UserPlus, Trash2, X } from "lucide-react";
import { useTeam } from "@/app/hooks/useTeam";
import { roleBadgeStyle } from "@/app/lib/roleStyles";

const ROLES = ["Founder", "Strategist", "Editor", "Media Buyer", "Graphic Designer"];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", backgroundColor: "var(--nested)",
  border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text)",
  fontSize: "14px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px",
};

export default function SettingsView() {
  const { team, loading, inviteMember, changeRole, removeMember } = useTeam();
  const [showInvite, setShowInvite] = useState(false);

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Settings</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
          Manage your team and dropdown lists.
        </p>
      </div>

      {/* ---- TEAM SECTION ---- */}
      <div style={{ marginBottom: "40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, margin: 0 }}>Team</h2>
          <button
            onClick={() => setShowInvite(true)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "7px 12px", backgroundColor: "var(--accent)", border: "none",
              borderRadius: "6px", color: "#0d0d0f", fontSize: "13px", fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <UserPlus size={15} /> Invite member
          </button>
        </div>

        {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}

        {!loading && team.length === 0 && (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px", border: "1px dashed var(--border)", borderRadius: "10px" }}>
            No team members yet. Invite someone to get started.
          </div>
        )}

        {!loading && team.length > 0 && (
          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
            {team.map((m, i) => (
              <div
                key={m.id}
                style={{
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "12px 16px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text)" }}>{m.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{m.email || "—"}</div>
                </div>

                {/* Status badge */}
                <span style={{
                  fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px",
                  backgroundColor: m.status === "active" ? "#052e16" : "#422006",
                  color: m.status === "active" ? "#4ade80" : "#fcd34d",
                }}>
                  {m.status === "active" ? "Active" : "Invited"}
                </span>

                {/* Role badge */}
                {(() => {
                  const rb = roleBadgeStyle(m.role);
                  return (
                    <span style={{
                      fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px",
                      backgroundColor: rb.bg, color: rb.color, whiteSpace: "nowrap",
                    }}>
                      {m.role}
                    </span>
                  );
                })()}

                {/* Role dropdown */}
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.id, e.target.value)}
                  style={{ ...inputStyle, width: "auto", minWidth: "150px", fontSize: "13px", padding: "6px 8px" }}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>

                {/* Remove */}
                <button
                  onClick={() => removeMember(m.id)}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: "6px", color: "#fca5a5", cursor: "pointer", padding: "6px", display: "flex" }}
                  aria-label="Remove member"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lists section placeholder (managed dropdowns come next) */}
      <div>
        <h2 style={{ fontSize: "15px", fontWeight: 600, margin: "0 0 8px 0" }}>Lists</h2>
        <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          Managed dropdown lists (personas, angles, concepts, etc.) — coming next.
        </p>
      </div>

      {showInvite && (
        <InviteModal onClose={() => setShowInvite(false)} onInvite={inviteMember} />
      )}
    </div>
  );
}

function InviteModal({
  onClose, onInvite,
}: {
  onClose: () => void;
  onInvite: (name: string, email: string, role: string) => Promise<{ error: string | null }>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Strategist");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSend() {
    if (!name.trim() || !email.trim()) return;
    setSending(true);
    setError(null);
    const { error } = await onInvite(name.trim(), email.trim(), role);
    setSending(false);
    if (error) setError(error);
    else setDone(true);
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: "400px", backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: 0 }}>Invite member</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex" }}>
            <X size={18} />
          </button>
        </div>

        {done ? (
          <div>
            <p style={{ fontSize: "14px", color: "var(--text)", lineHeight: 1.5, margin: "0 0 16px 0" }}>
              Invite sent to <strong>{email}</strong>. They’ll get an email to set their password.
            </p>
            <button onClick={onClose} style={{ padding: "8px 14px", backgroundColor: "var(--accent)", border: "none", borderRadius: "6px", color: "#0d0d0f", fontSize: "14px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit", width: "100%" }}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" />
              </div>
              <div>
                <label style={labelStyle}>Role</label>
                <select style={inputStyle} value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {error && (
                <div style={{ fontSize: "13px", color: "#fca5a5", backgroundColor: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "6px", padding: "8px 10px" }}>
                  {error}
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "24px" }}>
              <button onClick={onClose} style={{ padding: "8px 14px", backgroundColor: "transparent", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--text-secondary)", fontSize: "14px", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
              <button
                onClick={handleSend}
                disabled={!name.trim() || !email.trim() || sending}
                style={{
                  padding: "8px 14px",
                  backgroundColor: (name.trim() && email.trim()) ? "var(--accent)" : "var(--raised)",
                  border: "none", borderRadius: "6px",
                  color: (name.trim() && email.trim()) ? "#0d0d0f" : "var(--text-muted)",
                  fontSize: "14px", fontWeight: 500,
                  cursor: (name.trim() && email.trim() && !sending) ? "pointer" : "default", fontFamily: "inherit",
                }}
              >
                {sending ? "Sending…" : "Send invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
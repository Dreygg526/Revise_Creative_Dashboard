"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/app/hooks/useAuth";

export default function SetPasswordPage() {
  const { setPassword, session } = useAuth();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    if (pw.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (pw !== confirm) { setError("Passwords don’t match."); return; }
    setSaving(true);
    const { error } = await setPassword(pw);
    setSaving(false);
    if (error) setError(error);
    // On success, needsPassword flips false and the app shows the dashboard.
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", backgroundColor: "var(--nested)",
    border: "1px solid var(--border)", borderRadius: "8px", color: "var(--text)",
    fontSize: "14px", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px",
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ width: "100%", maxWidth: "380px" }}>
        <div style={{ marginBottom: "28px", textAlign: "center" }}>
          <div style={{ fontSize: "18px", fontWeight: 600, letterSpacing: "-0.01em" }}>Revise</div>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "2px" }}>Creative Dashboard</div>
        </div>

        <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h1 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 6px 0" }}>Welcome{session?.user?.email ? `, ${session.user.email}` : ""}</h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 20px 0", lineHeight: 1.5 }}>
            Set a password to finish setting up your account.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={labelStyle}>New password</label>
              <div style={{ position: "relative" }}>
                <input
                  style={{ ...inputStyle, paddingRight: "40px" }}
                  type={showPw ? "text" : "password"}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="At least 8 characters"
                  autoFocus
                />
                <button type="button" onClick={() => setShowPw((s) => !s)}
                  style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "4px", display: "flex" }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Confirm password</label>
              <input
                style={inputStyle}
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder="Re-enter password"
              />
            </div>

            {error && (
              <div style={{ fontSize: "13px", color: "#fca5a5", backgroundColor: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "6px", padding: "8px 10px" }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={!pw || !confirm || saving}
              style={{
                marginTop: "4px", padding: "10px 14px",
                backgroundColor: (pw && confirm) ? "var(--accent)" : "var(--raised)",
                border: "none", borderRadius: "8px",
                color: (pw && confirm) ? "#0d0d0f" : "var(--text-muted)",
                fontSize: "14px", fontWeight: 500,
                cursor: (pw && confirm && !saving) ? "pointer" : "default", fontFamily: "inherit",
              }}
            >
              {saving ? "Saving…" : "Set password & continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
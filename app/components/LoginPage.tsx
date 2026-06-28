"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/app/hooks/useAuth";

export default function LoginPage() {
  const { signIn, sendReset } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password) return;
    setSubmitting(true);
    setError(null);
    const { error } = await signIn(email.trim(), password);
    if (error) {
      setError(error);
      setSubmitting(false);
    }
    // On success, the auth listener flips the app to the dashboard automatically.
  }

  async function handleReset() {
    if (!email.trim()) { setError("Enter your email first."); return; }
    setSubmitting(true);
    setError(null);
    const { error } = await sendReset(email.trim());
    setSubmitting(false);
    if (error) setError(error);
    else setResetSent(true);
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
        {/* Brand */}
        <div style={{ marginBottom: "28px", textAlign: "center" }}>
          <div style={{ fontSize: "18px", fontWeight: 600, letterSpacing: "-0.01em" }}>Revise</div>
          <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "2px" }}>Creative Dashboard</div>
        </div>

        <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px" }}>
          <h1 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 20px 0" }}>Sign in</h1>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                style={inputStyle}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="you@thestandardlab.com"
                autoFocus
              />
            </div>

            <div>
              <label style={labelStyle}>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  style={{ ...inputStyle, paddingRight: "40px" }}
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  style={{
                    position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer",
                    padding: "4px", display: "flex",
                  }}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ fontSize: "13px", color: "#fca5a5", backgroundColor: "#450a0a", border: "1px solid #7f1d1d", borderRadius: "6px", padding: "8px 10px" }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!email.trim() || !password || submitting}
              style={{
                marginTop: "4px", padding: "10px 14px",
                backgroundColor: (email.trim() && password) ? "var(--accent)" : "var(--raised)",
                border: "none", borderRadius: "8px",
                color: (email.trim() && password) ? "#0d0d0f" : "var(--text-muted)",
                fontSize: "14px", fontWeight: 500,
                cursor: (email.trim() && password && !submitting) ? "pointer" : "default",
                fontFamily: "inherit",
              }}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>

            {/* Forgot password */}
            {!resetSent ? (
              <button
                type="button"
                onClick={handleReset}
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "12px", cursor: "pointer", fontFamily: "inherit", textAlign: "center", marginTop: "2px" }}
              >
                Forgot password?
              </button>
            ) : (
              <div style={{ fontSize: "12px", color: "#4ade80", textAlign: "center", marginTop: "2px" }}>
                Reset link sent — check your email.
              </div>
            )}
          </div>
        </div>

        <p style={{ textAlign: "center", fontSize: "12px", color: "var(--text-muted)", marginTop: "16px" }}>
          Access is invite-only. Contact your founder for an invite.
        </p>
      </div>
    </div>
  );
}
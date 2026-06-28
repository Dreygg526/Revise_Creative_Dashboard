"use client";

import { useState } from "react";
import {
  LayoutGrid,
  BarChart3,
  Lightbulb,
  FileText,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/app/hooks/useAuth";
import LoginPage from "@/app/components/LoginPage";
import SetPasswordPage from "@/app/components/SetPasswordPage";
import { useMyRole } from "@/app/hooks/useMyRole";
import { roleBadgeStyle } from "@/app/lib/roleStyles";

import PipelineView from "@/app/components/views/PipelineView";
import AnalyticsView from "@/app/components/views/AnalyticsView";
import LearningsView from "@/app/components/views/LearningsView";
import ReportsView from "@/app/components/views/ReportsView";
import SettingsView from "@/app/components/views/SettingsView";

// The five views the dashboard has. `key` is used for routing,
// `label` is what the user sees, `icon` is the Lucide line-icon.
const NAV_ITEMS = [
  { key: "pipeline", label: "Pipeline", icon: LayoutGrid },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "learnings", label: "Learnings", icon: Lightbulb },
  { key: "reports", label: "Reports", icon: FileText },
  { key: "settings", label: "Settings", icon: SettingsIcon },
] as const;

type ViewKey = (typeof NAV_ITEMS)[number]["key"];

export default function Home() {
  const { session, loading, needsPassword, signOut } = useAuth();
  const myRole = useMyRole();
  const [activeView, setActiveView] = useState<ViewKey>("pipeline");

  // Auth gate: while checking, show nothing; if not logged in, show login.
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "14px" }}>
        Loading…
      </div>
    );
  }
  // If the user arrived via an invite/reset link, force password setup first.
  if (needsPassword) {
    return <SetPasswordPage />;
  }
  if (!session) {
    return <LoginPage />;
  }

  function renderView() {
    switch (activeView) {
      case "pipeline":
        return <PipelineView />;
      case "analytics":
        return <AnalyticsView />;
      case "learnings":
        return <LearningsView />;
      case "reports":
        return <ReportsView />;
      case "settings":
        return <SettingsView />;
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* ---------- SIDEBAR ---------- */}
      <aside
        style={{
          width: "256px",
          flexShrink: 0,
          backgroundColor: "var(--card)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          padding: "20px 12px",
        }}
      >
        {/* App name */}
        <div style={{ padding: "0 12px 24px 12px" }}>
          <div
            style={{
              fontSize: "15px",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--text)",
            }}
          >
            Revise
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              marginTop: "2px",
            }}
          >
            Creative Dashboard
          </div>
        </div>

        {/* Nav items */}
        <nav style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setActiveView(item.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: isActive ? 500 : 400,
                  textAlign: "left",
                  width: "100%",
                  backgroundColor: isActive ? "var(--raised)" : "transparent",
                  color: isActive ? "var(--text)" : "var(--text-secondary)",
                  transition: "background-color 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.backgroundColor = "var(--hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Icon size={18} strokeWidth={1.75} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Logout pinned to the bottom */}
        <div style={{ marginTop: "auto", paddingTop: "12px" }}>
          <div style={{ padding: "0 12px 8px 12px" }}>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: "4px" }}>
              {session.user.email}
            </div>
            {myRole && (() => {
              const rb = roleBadgeStyle(myRole);
              return (
                <span style={{
                  fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px",
                  backgroundColor: rb.bg, color: rb.color,
                }}>
                  {myRole}
                </span>
              );
            })()}
          </div>
          <button
            onClick={signOut}
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "8px 12px", borderRadius: "8px", border: "none",
              cursor: "pointer", fontSize: "14px", fontWeight: 400,
              textAlign: "left", width: "100%",
              backgroundColor: "transparent", color: "var(--text-secondary)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <LogOut size={18} strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ---------- MAIN CONTENT ---------- */}
      <main style={{ flex: 1, padding: "32px 40px", overflowY: "auto" }}>
        {renderView()}
      </main>
    </div>
  );
}
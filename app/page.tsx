"use client";

import { useState } from "react";
import {
  LayoutGrid,
  BarChart3,
  Lightbulb,
  FileText,
  Settings as SettingsIcon,
} from "lucide-react";

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
  const [activeView, setActiveView] = useState<ViewKey>("pipeline");

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
      </aside>

      {/* ---------- MAIN CONTENT ---------- */}
      <main style={{ flex: 1, padding: "32px 40px", overflowY: "auto" }}>
        {renderView()}
      </main>
    </div>
  );
}
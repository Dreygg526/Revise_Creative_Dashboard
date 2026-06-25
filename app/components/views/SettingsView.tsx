"use client";

export default function SettingsView() {
  return (
    <div>
      <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
        Settings
      </h1>
      <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
        Manage dropdown lists and team members.
      </p>

      <div style={{ marginTop: "32px", color: "var(--text-muted)", fontSize: "14px" }}>
        Managed lists and team settings will go here.
      </div>
    </div>
  );
}
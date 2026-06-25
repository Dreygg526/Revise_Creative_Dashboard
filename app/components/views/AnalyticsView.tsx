"use client";

export default function AnalyticsView() {
  return (
    <div>
      <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
        Analytics
      </h1>
      <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
        Slice performance by persona, emotion, problem, and awareness.
      </p>

      <div style={{ marginTop: "32px", color: "var(--text-muted)", fontSize: "14px" }}>
        The analytics table will go here.
      </div>
    </div>
  );
}
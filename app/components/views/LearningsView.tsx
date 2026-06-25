"use client";

export default function LearningsView() {
  return (
    <div>
      <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>
        Learnings
      </h1>
      <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
        Lessons collected automatically as ads are closed.
      </p>

      <div style={{ marginTop: "32px", color: "var(--text-muted)", fontSize: "14px" }}>
        Closed-ad learnings will appear here.
      </div>
    </div>
  );
}
// Created-month category for an ad, derived from ads.created_at — not stored,
// so it can never drift from the real timestamp and needs no migration.
//
// Everything here reads the timestamp in UTC, on purpose: a category has to
// be the same for every viewer, and the team spans timezones (an ad made at
// 8am Oct 1 in Manila is Sep 30 in UTC). The monthly report computes its
// "created in month" view server-side in UTC too, so the board filter and the
// report always agree on which month an ad belongs to.
//
// Caveat worth knowing: the dashboard went live around July 2026, so older
// briefs (DTC #1–~80) carry the date they were entered, not when they were made.

export function createdMonth(createdAt: string | null | undefined): string | null {
  return createdAt ? createdAt.slice(0, 7) : null; // ISO, UTC → "YYYY-MM"
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function createdMonthLabel(createdAt: string | null | undefined): string | null {
  const m = createdMonth(createdAt);
  return m ? monthLabel(m) : null;
}

export function formatCreated(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

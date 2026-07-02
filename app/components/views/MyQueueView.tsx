"use client";

import { useMemo, useState } from "react";
import { useAds } from "@/app/hooks/useAds";
import { useSettings } from "@/app/hooks/useSettings";
import { useMyRole } from "@/app/hooks/useMyRole";
import { useAuth } from "@/app/hooks/useAuth";
import { supabase } from "@/lib/supabaseClient";
import AdDetailModal from "@/app/components/modals/AdDetailModal";
import type { Ad } from "@/app/types";
import { useEffect } from "react";

export default function MyQueueView() {
  const { ads, loading, error, updateAd, deleteAd } = useAds();
  const { valuesFor } = useSettings();
  const myRole = useMyRole();
  const { session } = useAuth();
  const [openAd, setOpenAd] = useState<Ad | null>(null);
  const [myName, setMyName] = useState<string | null>(null);

  const stages = valuesFor("stage");

  // Look up the logged-in user's NAME (ads store names, not emails).
  useEffect(() => {
    const email = session?.user?.email;
    if (!email) { setMyName(null); return; }
    supabase.from("team_members").select("name").eq("email", email).maybeSingle()
      .then(({ data }) => setMyName(data?.name ?? null));
  }, [session]);

  const isFounder = myRole === "Founder";

  // Which ads are "mine"?
  const myAds = useMemo(() => {
    if (isFounder) {
      // Founder: "needs attention" = overdue, unassigned editor, or stuck (no movement).
      const today = new Date().toISOString().slice(0, 10);
      return ads.filter((a) => {
        const overdue = a.due_date && a.due_date < today && a.stage !== "Winner / Killed";
        const unassigned = !a.assigned_editor && a.stage !== "Idea" && a.stage !== "Winner / Killed";
        return overdue || unassigned;
      });
    }
    if (!myName) return [];
    const editorRoles = myRole === "Editor" || myRole === "Graphic Designer";
    return ads.filter((a) => {
      if (myRole === "Strategist") return a.assigned_strategist === myName;
      if (editorRoles) return a.assigned_editor === myName;
      if (myRole === "Media Buyer") return a.assigned_media_buyer === myName;
      return false;
    });
  }, [ads, myName, myRole, isFounder]);

  const liveOpenAd = openAd ? ads.find((a) => a.id === openAd.id) ?? null : null;

  const today = new Date().toISOString().slice(0, 10);
  function isOverdue(a: Ad) {
    return a.due_date && a.due_date < today && a.stage !== "Winner / Killed";
  }

  // Group my ads by stage (only stages that have ads).
  const grouped = stages
    .map((stage) => ({ stage, items: myAds.filter((a) => a.stage === stage) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>My Queue</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
          {isFounder ? "Ads that need attention — overdue or unassigned." : "Ads assigned to you, grouped by stage."}
        </p>
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}
      {error && (
        <div style={{ backgroundColor: "#450a0a", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px" }}>
          Couldn’t load your queue: {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {grouped.length === 0 && (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px", border: "1px dashed var(--border)", borderRadius: "10px" }}>
              {isFounder ? "Nothing needs attention right now." : "Nothing assigned to you right now."}
            </div>
          )}

          {grouped.map((g) => (
            <div key={g.stage} style={{ marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                <h2 style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                  {g.stage}
                </h2>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{g.items.length}</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {g.items.map((ad) => {
                  const overdue = isOverdue(ad);
                  return (
                    <div
                      key={ad.id}
                      onClick={() => setOpenAd(ad)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        backgroundColor: "var(--card)",
                        border: overdue ? "1px solid #7f1d1d" : "1px solid var(--border)",
                        borderRadius: "8px", padding: "12px 14px", cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 500, minWidth: "54px" }}>
                          {ad.dtc_number != null ? `DTC #${ad.dtc_number}` : "—"}
                        </span>
                        <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text)" }}>
                          {ad.ad_name || "Untitled"}
                        </span>
                        {ad.product && <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>· {ad.product}</span>}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        {ad.stage === "Review" && (myRole === "Strategist" || isFounder) && (
                          <span style={{ fontSize: "10px", fontWeight: 600, color: "#93c5fd", backgroundColor: "#172554", padding: "2px 8px", borderRadius: "10px" }}>
                            Needs review
                          </span>
                        )}
                        {ad.revision_note && (
                          <span style={{ fontSize: "10px", fontWeight: 600, color: "#fca5a5", backgroundColor: "#450a0a", padding: "2px 8px", borderRadius: "10px" }}>
                            Needs revision
                          </span>
                        )}
                        {overdue && (
                          <span style={{ fontSize: "10px", fontWeight: 600, color: "#fca5a5", backgroundColor: "#450a0a", padding: "2px 8px", borderRadius: "10px" }}>
                            Overdue
                          </span>
                        )}
                        {ad.due_date && (
                          <span style={{ fontSize: "11px", color: overdue ? "#fca5a5" : "var(--text-muted)" }}>
                            Due {ad.due_date}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}

      {liveOpenAd && (
        <AdDetailModal
          ad={liveOpenAd}
          onClose={() => setOpenAd(null)}
          onSave={async (id, fields) => { await updateAd(id, fields); }}
          onDelete={async (id) => { await deleteAd(id); setOpenAd(null); }}
        />
      )}
    </div>
  );
}
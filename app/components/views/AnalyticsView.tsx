"use client";

import { useState, useMemo } from "react";
import { RefreshCw, AlertTriangle, Check, Copy, X, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import { useAds } from "@/app/hooks/useAds";
import { useTargets } from "@/app/hooks/useTargets";
import { useMyRole } from "@/app/hooks/useMyRole";
import { useMetaSync, useLastSyncRun, DATE_PRESETS, type UnmatchedMetaAd } from "@/app/hooks/useMetaSync";
import { can } from "@/app/lib/permissions";
import { effectivePerf, type Ad } from "@/app/types";
import AdDetailModal from "@/app/components/modals/AdDetailModal";
import AnalyticsOverview from "@/app/components/analytics/AnalyticsOverview";

// The dimensions you can group by. `key` is the Ad field, `label` is shown.
const GROUP_OPTIONS = [
  { key: "persona", label: "Persona" },
  { key: "core_emotion", label: "Core Emotion" },
  { key: "problem", label: "Problem" },
  { key: "awareness", label: "Awareness" },
  { key: "ad_type", label: "Ad Type" },
  { key: "concept", label: "Concept" },
] as const;

type GroupKey = (typeof GROUP_OPTIONS)[number]["key"];

// Which ads feed the table.
const MATCH_FILTERS = [
  { key: "all", label: "All ads" },
  { key: "matched", label: "Matched to Meta" },
  { key: "unmatched", label: "Not matched" },
] as const;

type MatchFilter = (typeof MATCH_FILTERS)[number]["key"];

interface GroupRow {
  label: string;
  ads: Ad[];
  count: number;
  spend: number;
  revenue: number;
  roas: number | null;
  purchases: number;
  cvr: number | null;
  cvrBlended: boolean;
  cpa: number | null;
  metaBacked: number;
}

export default function AnalyticsView() {
  const { ads, loading, error, fetchAds, updateAd, deleteAd } = useAds();
  const { targetCpa } = useTargets();
  const myRole = useMyRole();
  const { sync, syncing, result, error: syncError, dismiss } = useMetaSync();
  const { lastRun, refetchLastRun } = useLastSyncRun();

  const [groupBy, setGroupBy] = useState<GroupKey>("persona");
  const [datePreset, setDatePreset] = useState<string>("maximum");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openAd, setOpenAd] = useState<Ad | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(false);

  const allowSync = can(myRole, "edit_performance");

  async function runSync() {
    const res = await sync(datePreset);
    if (res) {
      await fetchAds();
      await refetchLastRun();
    }
  }

  function toggleExpanded(label: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  // Prefer the result from this session; otherwise fall back to the last run
  // stored in Supabase, so the panel survives a reload or a server restart.
  const shownResult = useMemo(() => {
    if (result) {
      return {
        rowsFetched: result.rowsFetched,
        adsMatched: result.adsMatched,
        adsUpdated: result.adsUpdated,
        unmatched: result.unmatched,
        unmatchedCount: result.unmatched.length,
        when: result.syncedAt,
        accountId: result.accountId,
        stale: false,
        truncated: result.truncated,
        writeErrors: result.writeErrors,
      };
    }
    if (lastRun) {
      return {
        rowsFetched: lastRun.rows_fetched,
        adsMatched: lastRun.ads_matched,
        adsUpdated: lastRun.ads_updated,
        unmatched: (lastRun.unmatched ?? []) as UnmatchedMetaAd[],
        unmatchedCount: lastRun.unmatched_count,
        when: lastRun.created_at,
        accountId: lastRun.ad_account_id,
        stale: true,
        truncated: false,
        writeErrors: [] as string[],
      };
    }
    return null;
  }, [result, lastRun]);

  // Strip the "act_" prefix — Ads Manager wants the bare numeric id.
  const adsManagerAccount = (shownResult?.accountId ?? "").replace(/^act_/, "");

  function adsManagerUrl(metaAdIds: string[] | null): string | null {
    if (!adsManagerAccount || !metaAdIds || metaAdIds.length === 0) return null;
    return (
      `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${adsManagerAccount}` +
      `&selected_ad_ids=${metaAdIds.slice(0, 50).join(",")}`
    );
  }

  const lastSynced = useMemo(() => {
    let latest: string | null = null;
    for (const ad of ads) {
      if (ad.meta_synced_at && (!latest || ad.meta_synced_at > latest)) latest = ad.meta_synced_at;
    }
    return latest;
  }, [ads]);

  // Apply the matched / unmatched filter before grouping.
  const visibleAds = useMemo(() => {
    if (matchFilter === "all") return ads;
    if (matchFilter === "matched") return ads.filter((a) => a.meta_synced_at != null);
    return ads.filter((a) => a.meta_synced_at == null);
  }, [ads, matchFilter]);

  const rows = useMemo<GroupRow[]>(() => {
    const map = new Map<string, Ad[]>();
    for (const ad of visibleAds) {
      const raw = ad[groupBy];
      const key = raw && String(raw).trim() ? String(raw) : "— Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ad);
    }

    const out: GroupRow[] = [];
    for (const [label, groupAds] of map.entries()) {
      let spend = 0, purchases = 0, revenue = 0, metaBacked = 0;
      // CVR is blended (total purchases / total clicks) wherever we have
      // click counts, so a 5-click ad can't swing the number as hard as a
      // 5,000-click one. Falls back to averaging stored CVR values only
      // when no click data exists at all.
      let clicks = 0, purchasesForCvr = 0, cvrSum = 0, cvrCount = 0;

      for (const ad of groupAds) {
        const perf = effectivePerf(ad);
        if (perf.source === "meta") metaBacked++;
        if (perf.spend != null) spend += perf.spend;
        if (perf.purchases != null) purchases += perf.purchases;
        if (perf.revenue != null) revenue += perf.revenue;

        if (ad.meta_clicks != null && ad.meta_clicks > 0) {
          clicks += ad.meta_clicks;
          purchasesForCvr += ad.meta_purchases ?? 0;
        } else if (perf.cvr != null) {
          cvrSum += perf.cvr;
          cvrCount++;
        }
      }

      const blended = clicks > 0;
      out.push({
        label,
        ads: groupAds,
        count: groupAds.length,
        spend,
        revenue,
        roas: spend > 0 && revenue > 0 ? revenue / spend : null,
        purchases,
        cvr: blended ? (purchasesForCvr / clicks) * 100 : cvrCount > 0 ? cvrSum / cvrCount : null,
        cvrBlended: blended,
        cpa: purchases > 0 ? spend / purchases : null,
        metaBacked,
      });
    }

    out.sort((a, b) => b.spend - a.spend || b.count - a.count);
    return out;
  }, [visibleAds, groupBy]);

  const totals = useMemo(() => {
    let spend = 0, purchases = 0, revenue = 0, count = 0, metaBacked = 0;
    let clicks = 0, purchasesForCvr = 0, cvrSum = 0, cvrCount = 0;
    for (const ad of visibleAds) {
      count++;
      const perf = effectivePerf(ad);
      if (perf.source === "meta") metaBacked++;
      if (perf.spend != null) spend += perf.spend;
      if (perf.purchases != null) purchases += perf.purchases;
      if (perf.revenue != null) revenue += perf.revenue;
      if (ad.meta_clicks != null && ad.meta_clicks > 0) {
        clicks += ad.meta_clicks;
        purchasesForCvr += ad.meta_purchases ?? 0;
      } else if (perf.cvr != null) { cvrSum += perf.cvr; cvrCount++; }
    }
    return {
      count, spend, purchases, revenue, metaBacked,
      roas: spend > 0 && revenue > 0 ? revenue / spend : null,
      cvr: clicks > 0 ? (purchasesForCvr / clicks) * 100 : cvrCount > 0 ? cvrSum / cvrCount : null,
      cpa: purchases > 0 ? spend / purchases : null,
    };
  }, [visibleAds]);

  function cpaColor(cpa: number | null): string {
    if (cpa == null || targetCpa == null) return "var(--text-secondary)";
    return cpa <= targetCpa ? "#4ade80" : "#fca5a5";
  }
  // Revenue vs ad spend only — this knows nothing about product margin,
  // so 1x is "made back the ad spend", not "profitable".
  function roasColor(roas: number | null): string {
    if (roas == null) return "var(--text-secondary)";
    if (roas >= 2) return "#4ade80";
    if (roas >= 1) return "#fbbf24";
    return "#fca5a5";
  }

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Analytics</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: "4px", fontSize: "14px" }}>
            Performance sliced by strategy. Pulled from Triple Whale by DTC number on the ad or ad set name.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <select
            value={datePreset}
            onChange={(e) => setDatePreset(e.target.value)}
            disabled={syncing || !allowSync}
            style={{
              padding: "7px 10px", borderRadius: "6px", border: "1px solid var(--border)",
              backgroundColor: "var(--card)", color: "var(--text)", fontSize: "13px",
              fontFamily: "inherit", cursor: allowSync ? "pointer" : "not-allowed",
            }}
          >
            {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>

          <button
            onClick={runSync}
            disabled={syncing || !allowSync}
            title={allowSync ? "Pull live spend, purchases and revenue" : "Only Founder, Strategist, and Media Buyer can sync performance data."}
            style={{
              display: "flex", alignItems: "center", gap: "7px",
              padding: "7px 14px", borderRadius: "6px", border: "none",
              backgroundColor: allowSync ? "var(--accent)" : "var(--nested)",
              color: allowSync ? "#0d0d0f" : "var(--text-muted)",
              fontSize: "13px", fontWeight: 600,
              cursor: syncing || !allowSync ? "not-allowed" : "pointer",
              opacity: syncing ? 0.7 : 1, fontFamily: "inherit",
            }}
          >
            <RefreshCw size={14} style={{ animation: syncing ? "spin 1s linear infinite" : undefined }} />
            {syncing ? "Syncing…" : "Sync performance"}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {syncError && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", backgroundColor: "#450a0a", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "13px", marginBottom: "16px" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "1px" }} />
          <div style={{ flex: 1 }}>{syncError}</div>
          <button onClick={dismiss} style={iconBtn}><X size={15} /></button>
        </div>
      )}

      {/* Sync result — from this session, or restored from the last stored run */}
      {shownResult && (
        <div style={{ backgroundColor: "var(--nested)", border: "1px solid var(--border)", borderRadius: "10px", padding: "14px 16px", marginBottom: "16px", fontSize: "13px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <Check size={15} color="#4ade80" />
            <span style={{ color: "var(--text)" }}>
              Pulled <strong>{shownResult.rowsFetched}</strong> Meta ads · matched{" "}
              <strong>{shownResult.adsMatched}</strong> dashboard {shownResult.adsMatched === 1 ? "ad" : "ads"} ·{" "}
              <strong>{shownResult.adsUpdated}</strong> updated
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              {shownResult.stale ? "last run " : ""}
              {new Date(shownResult.when).toLocaleString()}
            </span>
            {result && <button onClick={dismiss} style={{ ...iconBtn, marginLeft: "auto" }}><X size={15} /></button>}
          </div>

          {shownResult.truncated && (
            <div style={{ color: "#fbbf24", fontSize: "12px", marginTop: "8px" }}>
              Hit the page limit — some Meta ads weren’t fetched. Try a shorter date range.
            </div>
          )}
          {shownResult.writeErrors.length > 0 && (
            <div style={{ color: "#fca5a5", fontSize: "12px", marginTop: "8px" }}>
              {shownResult.writeErrors.length} row(s) failed to save: {shownResult.writeErrors[0]}
            </div>
          )}

          {shownResult.unmatchedCount > 0 && (
            <div style={{ marginTop: "10px" }}>
              <button
                onClick={() => setShowUnmatched((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px", background: "none",
                  border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
                  fontSize: "12px", color: "#fbbf24", fontWeight: 600,
                }}
              >
                {showUnmatched ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                {shownResult.unmatchedCount} Meta {shownResult.unmatchedCount === 1 ? "ad" : "ads"} couldn’t be matched
              </button>

              {showUnmatched && (
                <>
                  <div style={{ color: "var(--text-secondary)", margin: "8px 0", fontSize: "12px" }}>
                    Add the DTC number to the ad or ad set name in Ads Manager, or paste a Meta ad ID
                    into the dashboard ad’s “Meta ad ID” field to link it by hand.
                  </div>
                  {shownResult.unmatched.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      The detailed list wasn’t stored for this run. Sync again to rebuild it.
                    </div>
                  ) : (
                    <div style={{ maxHeight: "260px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                        <thead>
                          <tr style={{ backgroundColor: "var(--card)", textAlign: "left" }}>
                            <th style={unTh}>Meta ad name</th>
                            <th style={unTh}>Spend</th>
                            <th style={unTh}>Why</th>
                            <th style={unTh}>Ad ID</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shownResult.unmatched.map((u) => (
                            <tr key={u.ad_id} style={{ borderTop: "1px solid var(--border)" }}>
                              <td style={unTd}>
                                <div style={{ color: "var(--text)" }}>{u.ad_name || "(no name)"}</div>
                                {u.campaign_name && <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>{u.campaign_name}</div>}
                              </td>
                              <td style={{ ...unTd, whiteSpace: "nowrap" }}>{fmt(u.spend)}</td>
                              <td style={{ ...unTd, color: "var(--text-muted)" }}>{u.reason}</td>
                              <td style={{ ...unTd, whiteSpace: "nowrap" }}>
                                <button onClick={() => navigator.clipboard?.writeText(u.ad_id)} title="Copy Meta ad ID" style={copyBtn}>
                                  <Copy size={11} /> {u.ad_id}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* All controls sit together at the top, above everything they drive. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", color: "var(--text-muted)", minWidth: "58px" }}>Show</span>
          {MATCH_FILTERS.map((f) => {
            const n = f.key === "all" ? ads.length
              : f.key === "matched" ? ads.filter((a) => a.meta_synced_at != null).length
              : ads.filter((a) => a.meta_synced_at == null).length;
            return (
              <Pill key={f.key} active={matchFilter === f.key} onClick={() => setMatchFilter(f.key)}>
                {f.label} <span style={{ opacity: 0.65 }}>({n})</span>
              </Pill>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", color: "var(--text-muted)", minWidth: "58px" }}>Group by</span>
          {GROUP_OPTIONS.map((opt) => (
            <Pill key={opt.key} active={groupBy === opt.key} onClick={() => setGroupBy(opt.key)}>{opt.label}</Pill>
          ))}
        </div>
      </div>

      {loading && <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading…</p>}
      {error && (
        <div style={{ backgroundColor: "#450a0a", color: "#fca5a5", padding: "12px 16px", borderRadius: "8px", border: "1px solid #7f1d1d", fontSize: "14px" }}>
          Couldn’t load analytics: {error}
        </div>
      )}

      {!loading && !error && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ backgroundColor: "var(--nested)", textAlign: "left" }}>
                <Th>{GROUP_OPTIONS.find((g) => g.key === groupBy)?.label}</Th>
                <Th right>Ads</Th>
                <Th right>Spend</Th>
                <Th right>Revenue</Th>
                <Th right>ROAS</Th>
                <Th right>Purchases</Th>
                <Th right>CPA</Th>
                <Th right>CVR</Th>
                <Th right>Live</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded.has(r.label);
                return [
                  <tr
                    key={r.label}
                    onClick={() => toggleExpanded(r.label)}
                    style={{ borderTop: "1px solid var(--border)", cursor: "pointer", backgroundColor: isOpen ? "var(--nested)" : undefined }}
                  >
                    <Td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        {isOpen ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
                        {r.label}
                      </span>
                    </Td>
                    <Td right muted>{r.count}</Td>
                    <Td right>{r.spend > 0 ? fmt(r.spend) : "—"}</Td>
                    <Td right>{r.revenue > 0 ? fmt(r.revenue) : "—"}</Td>
                    <Td right color={roasColor(r.roas)}>{r.roas != null ? r.roas.toFixed(2) + "x" : "—"}</Td>
                    <Td right>{r.purchases > 0 ? fmt(r.purchases) : "—"}</Td>
                    <Td right color={cpaColor(r.cpa)}>{r.cpa != null ? fmt(r.cpa) : "—"}</Td>
                    <Td right>{r.cvr != null ? fmt(r.cvr) + "%" : "—"}</Td>
                    <Td right muted>{r.metaBacked > 0 ? `${r.metaBacked}/${r.count}` : "—"}</Td>
                  </tr>,

                  // Child rows live in the SAME table, not a nested one, so
                  // every number sits under its own header. A nested table
                  // gets its own column widths and silently misaligns.
                  ...(isOpen
                    ? [...r.ads]
                        .sort((a, b) => (effectivePerf(b).spend ?? 0) - (effectivePerf(a).spend ?? 0))
                        .map((ad) => {
                          const perf = effectivePerf(ad);
                          const url = adsManagerUrl(ad.meta_ad_ids);
                          const rollup = ad.meta_matched_count ?? 0;
                          return (
                            <tr key={ad.id} style={{ borderTop: "1px solid var(--border)", backgroundColor: "var(--nested)" }}>
                              <td style={{ padding: "8px 14px 8px 34px" }}>
                                <button onClick={() => setOpenAd(ad)} style={linkBtn} title="Open this ad">
                                  {ad.dtc_number != null ? `DTC #${ad.dtc_number}` : "—"} · {ad.ad_name || "Untitled"}
                                </button>
                                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                                  {perf.source === "meta"
                                    ? `${rollup || 1} Meta ad${(rollup || 1) > 1 ? "s" : ""} · ${(ad.meta_match_method ?? "").replace(/_/g, " ")}`
                                    : perf.source === "manual" ? "manual close-out entry" : "no performance data"}
                                  {url && (
                                    <>
                                      {" · "}
                                      <a href={url} target="_blank" rel="noopener noreferrer" title="Open in Meta Ads Manager" style={{ ...linkBtn, fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                        Ads Manager <ExternalLink size={10} />
                                      </a>
                                    </>
                                  )}
                                </div>
                              </td>
                              <Td right muted>—</Td>
                              <Td right>{perf.spend != null ? fmt(perf.spend) : "—"}</Td>
                              <Td right>{perf.revenue != null ? fmt(perf.revenue) : "—"}</Td>
                              <Td right color={roasColor(perf.roas)}>{perf.roas != null ? perf.roas.toFixed(2) + "x" : "—"}</Td>
                              <Td right>{perf.purchases != null ? fmt(perf.purchases) : "—"}</Td>
                              <Td right color={cpaColor(perf.cpa)}>{perf.cpa != null ? fmt(perf.cpa) : "—"}</Td>
                              <Td right>{perf.cvr != null ? fmt(perf.cvr) + "%" : "—"}</Td>
                              <Td right muted>{perf.source === "meta" ? "Meta" : perf.source === "manual" ? "manual" : "—"}</Td>
                            </tr>
                          );
                        })
                    : []),
                ];
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
                    No ads match this filter.
                  </td>
                </tr>
              )}
            </tbody>

            {rows.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)", backgroundColor: "var(--nested)" }}>
                  <Td><strong>{matchFilter === "all" ? "All ads" : MATCH_FILTERS.find((f) => f.key === matchFilter)?.label}</strong></Td>
                  <Td right muted>{totals.count}</Td>
                  <Td right>{totals.spend > 0 ? fmt(totals.spend) : "—"}</Td>
                  <Td right>{totals.revenue > 0 ? fmt(totals.revenue) : "—"}</Td>
                  <Td right color={roasColor(totals.roas)}>{totals.roas != null ? totals.roas.toFixed(2) + "x" : "—"}</Td>
                  <Td right>{totals.purchases > 0 ? fmt(totals.purchases) : "—"}</Td>
                  <Td right color={cpaColor(totals.cpa)}>{totals.cpa != null ? fmt(totals.cpa) : "—"}</Td>
                  <Td right>{totals.cvr != null ? fmt(totals.cvr) + "%" : "—"}</Td>
                  <Td right muted>{totals.metaBacked > 0 ? `${totals.metaBacked}/${totals.count}` : "—"}</Td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.6 }}>
        <div>Click a row to see the ads inside it. CPA at or under the {targetCpa ?? "—"} target shows green.</div>
        <div>
          ROAS is Meta-reported revenue ÷ ad spend — <strong>it knows nothing about your product margin</strong>, so 1x means you earned the ad spend back, not that you profited. Green ≥ 2x, amber ≥ 1x.
        </div>
        <div>
          CVR is blended (total purchases ÷ total link clicks), not an average of per-ad rates, so small ads can’t skew it.
          “Live” counts ads whose numbers came from Meta; the rest fall back to manual close-out entries, which a sync never overwrites.
          {lastSynced && ` Last synced ${new Date(lastSynced).toLocaleString()}.`}
        </div>
      </div>

      {/* Overview sits under the table: the table is the thing people came to
          read, the charts are the summary they scroll to afterwards. */}
      {!loading && !error && (
        <div style={{ marginTop: "24px" }}>
          <AnalyticsOverview
            ads={visibleAds}
            targetCpa={targetCpa}
            onOpenAd={setOpenAd}
          />
        </div>
      )}

      {openAd && (
        <AdDetailModal
          ad={openAd}
          onClose={() => setOpenAd(null)}
          onSave={async (id, fields) => { await updateAd(id, fields); }}
          onDelete={async (id) => { await deleteAd(id); setOpenAd(null); }}
        />
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0, display: "flex",
};
const copyBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: "5px", background: "none",
  border: "1px solid var(--border)", borderRadius: "5px", color: "var(--text-secondary)",
  cursor: "pointer", padding: "3px 7px", fontSize: "11px", fontFamily: "inherit",
};
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", padding: 0, color: "var(--accent)",
  cursor: "pointer", fontSize: "12px", fontFamily: "inherit", textAlign: "left", textDecoration: "none",
};
const unTh: React.CSSProperties = {
  padding: "7px 10px", fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap",
};
const unTd: React.CSSProperties = {
  padding: "7px 10px", verticalAlign: "top", color: "var(--text-secondary)",
};

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px", borderRadius: "6px",
        border: active ? "none" : "1px solid var(--border)",
        backgroundColor: active ? "var(--accent)" : "transparent",
        color: active ? "#0d0d0f" : "var(--text-secondary)",
        fontSize: "13px", fontWeight: active ? 600 : 400,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{ padding: "10px 14px", fontWeight: 500, color: "var(--text-secondary)", textAlign: right ? "right" : "left", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function Td({ children, right, muted, color }: { children: React.ReactNode; right?: boolean; muted?: boolean; color?: string }) {
  return (
    <td style={{ padding: "10px 14px", textAlign: right ? "right" : "left", color: color ?? (muted ? "var(--text-muted)" : "var(--text)"), whiteSpace: "nowrap" }}>
      {children}
    </td>
  );
}

// ============================================================
// META MATCHING — links Meta ads to dashboard ads.
//
// Meta's ad_id is assigned by Meta and can't be set to your DTC
// number, so the only thing we can match on is the ad NAME the
// media buyer typed in Ads Manager. Those names are messy:
//
//   "DTC 142 - Sleep Angle v2 | Broad | 9x16"
//   "142_sleepangle_UGC_hook2"
//   "DTC#142 Sleep Angle (retest)"
//
// Requiring an exact string match would silently drop all three.
// So we pull the DTC number OUT of the name instead. The only rule
// the team has to follow is "put the DTC number in the ad name" —
// everything else stays free-form.
//
// Pure functions only: no network, no Supabase. Easy to reason about
// and to try in isolation when a name won't match.
// ============================================================

import type { Ad, MetaMatchMethod } from "@/app/types";

// One row from the Meta insights endpoint, already normalized to numbers.
export interface MetaInsightRow {
  ad_id: string;
  ad_name: string;
  adset_name: string | null;
  campaign_name: string | null;
  spend: number;
  purchases: number;
  revenue: number;              // purchase conversion value
  impressions: number;
  clicks: number;
}

// The rolled-up result for a single dashboard ad.
export interface MetaMatch {
  adId: string;                 // dashboard ads.id
  method: MetaMatchMethod;
  spend: number;
  purchases: number;
  revenue: number;
  impressions: number;
  clicks: number;
  cvr: number | null;           // purchases / clicks * 100
  matchedName: string;          // Meta ad name(s) that fed this row
  matchedCount: number;         // how many Meta ads rolled up
  metaAdIds: string[];
}

export interface MatchResult {
  matches: MetaMatch[];
  // Meta ads we couldn't place. Surfaced in the UI so someone can copy
  // the ad ID into the dashboard ad's override field.
  unmatched: Array<{
    ad_id: string;
    ad_name: string;
    campaign_name: string | null;
    spend: number;
    purchases: number;
    reason: string;
  }>;
}

// ------------------------------------------------------------
// DTC NUMBER EXTRACTION
// ------------------------------------------------------------

// Explicit "DTC" prefix in any of the shapes people actually type:
// "DTC 142", "DTC#142", "DTC-142", "dtc_142", "DTC142", "dtc.142".
const DTC_PREFIXED = /dtc[\s\-#_:.]*(\d{1,6})/i;

// A bare leading number: "142_sleepangle", "#142 Sleep Angle", "142 - Foo".
// Anchored to the start so we never pick up "v3" or a date from the
// middle of a name. The trailing lookahead requires a separator, which
// keeps aspect ratios out: "9x16_sleepangle" must NOT read as DTC #9.
const DTC_LEADING = /^[\s#]*(\d{1,6})(?=$|[\s\-_|.:,])/;

/**
 * Pull a DTC number out of a Meta ad name.
 * Returns null when the name carries no usable number.
 */
export function extractDtcNumber(name: string | null | undefined): number | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  // An explicit "DTC" marker is the strongest signal — always prefer it.
  const prefixed = trimmed.match(DTC_PREFIXED);
  if (prefixed) {
    const n = Number(prefixed[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Otherwise accept a number only at the very start of the name.
  const leading = trimmed.match(DTC_LEADING);
  if (leading) {
    const n = Number(leading[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  return null;
}

// Strip everything but letters and digits so "Sleep Angle v2" and
// "sleep-angle-v2" compare equal.
export function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// CVR as a percentage of link clicks. Meta has no single "CVR" field,
// so we derive it and keep the inputs (clicks, purchases) stored
// alongside for auditing.
function calcCvr(purchases: number, clicks: number): number | null {
  if (!clicks || clicks <= 0) return null;
  return (purchases / clicks) * 100;
}

// ------------------------------------------------------------
// THE MATCHER
// ------------------------------------------------------------

/**
 * Match Meta insight rows to dashboard ads.
 *
 * Precedence, highest first:
 *   1. meta_ad_id override — someone pasted the Meta ad ID by hand
 *   2. DTC number parsed out of the Meta ad name
 *   3. ad_name text match (only when exactly one dashboard ad fits)
 *
 * Several Meta ads legitimately map to one DTC number (variants,
 * duplicates across adsets, relaunches) — those get SUMMED, not
 * arbitrarily picked between.
 */
export function matchInsights(rows: MetaInsightRow[], ads: Ad[]): MatchResult {
  // ---- Build lookup tables once ----
  const byOverrideId = new Map<string, Ad>();
  const byDtc = new Map<number, Ad>();
  const byName = new Map<string, Ad[]>();

  for (const ad of ads) {
    if (ad.meta_ad_id) {
      byOverrideId.set(ad.meta_ad_id.trim(), ad);
    }
    if (ad.dtc_number != null) {
      // If two dashboard ads somehow share a DTC number, first wins —
      // dtc_number is meant to be unique.
      if (!byDtc.has(ad.dtc_number)) byDtc.set(ad.dtc_number, ad);
    }
    const key = normalizeName(ad.ad_name);
    if (key) {
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(ad);
    }
  }

  // Accumulate per dashboard ad, so multiple Meta rows roll up.
  const acc = new Map<string, MetaMatch>();
  const unmatched: MatchResult["unmatched"] = [];

  function add(ad: Ad, row: MetaInsightRow, method: MetaMatchMethod) {
    const existing = acc.get(ad.id);
    if (existing) {
      existing.spend += row.spend;
      existing.purchases += row.purchases;
      existing.revenue += row.revenue;
      existing.impressions += row.impressions;
      existing.clicks += row.clicks;
      existing.matchedCount += 1;
      existing.metaAdIds.push(row.ad_id);
      existing.matchedName = `${existing.matchedName}, ${row.ad_name}`;
      existing.cvr = calcCvr(existing.purchases, existing.clicks);
      // An explicit override outranks whatever matched first.
      if (method === "override") existing.method = "override";
      return;
    }
    acc.set(ad.id, {
      adId: ad.id,
      method,
      spend: row.spend,
      purchases: row.purchases,
      revenue: row.revenue,
      impressions: row.impressions,
      clicks: row.clicks,
      cvr: calcCvr(row.purchases, row.clicks),
      matchedName: row.ad_name,
      matchedCount: 1,
      metaAdIds: [row.ad_id],
    });
  }

  for (const row of rows) {
    // 1. Manual override wins outright.
    const overridden = byOverrideId.get(row.ad_id);
    if (overridden) {
      add(overridden, row, "override");
      continue;
    }

    // 2. DTC number parsed from the Meta names, most specific first.
    //    The ad name identifies the creative; the ad set identifies the
    //    brief. In practice the DTC number usually lives on the AD SET
    //    ("DTC #82 || Static Ad || ...") while the ad name is just the
    //    variant ("VARIATION 3 II PDP"), so we have to check both.
    const candidates: Array<{ dtc: number; method: MetaMatchMethod }> = [];
    const fromAd = extractDtcNumber(row.ad_name);
    const fromAdset = extractDtcNumber(row.adset_name);
    const fromCampaign = extractDtcNumber(row.campaign_name);
    if (fromAd != null) candidates.push({ dtc: fromAd, method: "dtc_number" });
    if (fromAdset != null) candidates.push({ dtc: fromAdset, method: "dtc_adset" });
    if (fromCampaign != null) candidates.push({ dtc: fromCampaign, method: "dtc_campaign" });

    if (candidates.length > 0) {
      // Take the first candidate that resolves to a real dashboard ad, so a
      // stale number on one field can still fall through to another.
      const resolved = candidates.find((c) => byDtc.has(c.dtc));
      if (resolved) {
        add(byDtc.get(resolved.dtc)!, row, resolved.method);
        continue;
      }
      const seen = [...new Set(candidates.map((c) => c.dtc))].join(", #");
      unmatched.push({
        ad_id: row.ad_id,
        ad_name: row.ad_name,
        campaign_name: row.campaign_name,
        spend: row.spend,
        purchases: row.purchases,
        reason: `Names reference DTC #${seen}, but no dashboard ad has that number.`,
      });
      continue;
    }

    // 3. Fall back to the ad name — but only when it's unambiguous.
    const norm = normalizeName(row.ad_name);
    const exact = byName.get(norm);
    if (exact && exact.length === 1) {
      add(exact[0], row, "ad_name");
      continue;
    }
    if (exact && exact.length > 1) {
      unmatched.push({
        ad_id: row.ad_id,
        ad_name: row.ad_name,
        campaign_name: row.campaign_name,
        spend: row.spend,
        purchases: row.purchases,
        reason: `${exact.length} dashboard ads share this name — add the DTC number to the Meta ad name.`,
      });
      continue;
    }

    // Last resort: a dashboard ad name contained inside the Meta name,
    // e.g. Meta "Sleep Angle v2 | Broad" vs dashboard "Sleep Angle v2".
    // Only accepted when exactly one candidate fits.
    const contained = ads.filter((a) => {
      const k = normalizeName(a.ad_name);
      return k.length >= 6 && norm.includes(k);
    });
    if (contained.length === 1) {
      add(contained[0], row, "ad_name");
      continue;
    }

    unmatched.push({
      ad_id: row.ad_id,
      ad_name: row.ad_name,
      campaign_name: row.campaign_name,
      spend: row.spend,
      purchases: row.purchases,
      reason:
        contained.length > 1
          ? "Matches several dashboard ads by name — add the DTC number to the Meta ad name."
          : "No DTC number in the name and no dashboard ad with a matching name.",
    });
  }

  return { matches: [...acc.values()], unmatched };
}

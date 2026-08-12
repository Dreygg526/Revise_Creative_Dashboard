import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { matchInsights, type MetaInsightRow } from "@/app/lib/metaMatch";
import { activeProvider, fetchTripleWhaleRows, TripleWhaleError } from "@/app/lib/tripleWhale";
import { can } from "@/app/lib/permissions";
import type { Ad } from "@/app/types";

// This route runs ONLY on the server. META_ACCESS_TOKEN never reaches
// the browser — same pattern as /api/invite and /api/generate-copy.
export const runtime = "nodejs";
export const maxDuration = 60;

// Meta pins you to an API version; v25.0 is stable with a long runway
// (v26.0 shipped Jul 2026 but carries unrelated placement breakages).
// Override with META_API_VERSION if Meta sunsets it.
const API_VERSION = process.env.META_API_VERSION || "v25.0";
const DEFAULT_ACCOUNT = "act_2223260745102430";

// Guard rails so a runaway account can't spin forever.
const MAX_PAGES = 25;
const PAGE_LIMIT = 500;
const FETCH_TIMEOUT_MS = 25_000;

// Meta returns purchases inside an `actions` array. Several action types
// describe the same conversion, so we take the FIRST one present in this
// priority order rather than summing (which would double-count).
const PURCHASE_ACTION_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
];

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaRawRow {
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaAction[];
  action_values?: MetaAction[];
}

function num(v: string | undefined | null): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Works for both `actions` (purchase COUNT) and `action_values` (purchase
// VALUE / revenue) — same action_type keys, same first-match-wins rule.
function extractPurchaseMetric(entries: MetaAction[] | undefined): number {
  if (!Array.isArray(entries)) return 0;
  for (const type of PURCHASE_ACTION_TYPES) {
    const hit = entries.find((a) => a.action_type === type);
    if (hit) return num(hit.value);
  }
  return 0;
}

// Turn a Meta error payload into something a human can act on.
function describeMetaError(status: number, body: unknown): { message: string; status: number } {
  const err = (body as { error?: { code?: number; message?: string; error_user_msg?: string } })?.error;
  const code = err?.code;
  const raw = err?.error_user_msg || err?.message || "Unknown Meta API error.";

  // 190 = token expired / invalidated / revoked.
  if (code === 190) {
    return {
      message:
        "Meta rejected the access token (it expired, was revoked, or the password changed). " +
        "Generate a fresh long-lived or System User token and update META_ACCESS_TOKEN.",
      status: 401,
    };
  }
  // 4 = app-level throttle, 17 = user-level, 613 = custom-rate-limit.
  if (code === 4 || code === 17 || code === 613 || status === 429) {
    return {
      message:
        "Meta is rate-limiting this app right now. Wait a few minutes and sync again — " +
        "no data was changed.",
      status: 429,
    };
  }
  // 200/10 = missing permission on the ad account.
  if (code === 200 || code === 10) {
    return {
      message:
        "The token doesn't have permission to read this ad account's insights. " +
        "It needs the ads_read permission and access to " + (process.env.META_AD_ACCOUNT_ID || DEFAULT_ACCOUNT) + ".",
      status: 403,
    };
  }
  if (code === 100) {
    return { message: `Meta rejected the request parameters: ${raw}`, status: 400 };
  }
  return { message: `Meta API error: ${raw}`, status: status >= 400 ? status : 502 };
}

// The Meta path, unchanged in behaviour — lifted out of POST so the two
// providers sit side by side instead of one being nested inside the other.
// Returns either the rows or a ready-to-send error; the caller decides.
type MetaFetchResult =
  | { rows: MetaInsightRow[]; pages: number; truncated: boolean }
  | { error: string; status: number };

async function fetchMetaRows(opts: {
  token: string | undefined;
  accountId: string;
  datePreset: string;
  admin: SupabaseClient;
  email: string;
}): Promise<MetaFetchResult> {
  const { token, accountId, datePreset, admin, email } = opts;

  if (!token) {
    return {
      error:
        "Server is missing META_ACCESS_TOKEN. Add it in Vercel > Environment Variables " +
        "(and .env.local for dev) — or set TRIPLE_WHALE_API_KEY to sync from Triple Whale instead.",
      status: 500,
    };
  }

  const fields = [
    "ad_id",
    "ad_name",
    "adset_name",
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "actions",
    "action_values",
  ].join(",");

  let url =
    `https://graph.facebook.com/${API_VERSION}/${accountId}/insights` +
    `?level=ad&fields=${fields}&date_preset=${encodeURIComponent(datePreset)}` +
    `&limit=${PAGE_LIMIT}&access_token=${encodeURIComponent(token)}`;

  const rows: MetaInsightRow[] = [];
  let pages = 0;
  let truncated = false;

  while (url) {
    if (pages >= MAX_PAGES) {
      truncated = true;
      break;
    }

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      const aborted = e instanceof Error && e.name === "TimeoutError";
      return {
        error: aborted
          ? "Meta took too long to respond. Try a shorter date range (e.g. last 30 days)."
          : "Couldn't reach the Meta API. Check the server's network connection.",
        status: 504,
      };
    }

    const payload = await res.json().catch(() => null);

    if (!res.ok || payload?.error) {
      const { message, status } = describeMetaError(res.status, payload);
      // Log the failed run so there's a trail, then report it.
      await admin.from("meta_sync_runs").insert({
        ran_by: email,
        ad_account_id: accountId,
        date_preset: datePreset,
        error: message,
      });
      return { error: message, status };
    }

    for (const raw of (payload?.data ?? []) as MetaRawRow[]) {
      if (!raw.ad_id) continue;
      rows.push({
        ad_id: raw.ad_id,
        ad_name: raw.ad_name ?? "",
        adset_name: raw.adset_name ?? null,
        campaign_name: raw.campaign_name ?? null,
        spend: num(raw.spend),
        purchases: extractPurchaseMetric(raw.actions),
        revenue: extractPurchaseMetric(raw.action_values),
        impressions: num(raw.impressions),
        clicks: num(raw.clicks),
      });
    }

    pages++;
    url = payload?.paging?.next ?? "";
  }

  return { rows, pages, truncated };
}

export async function POST(req: Request) {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const accountId = process.env.META_AD_ACCOUNT_ID || DEFAULT_ACCOUNT;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // The service key is needed just to verify the caller, so it's checked
    // first. Everything else about server config stays hidden until we know
    // who's asking — an anonymous caller learns nothing.
    if (!serviceKey) {
      return NextResponse.json({ error: "Server is missing the service role key." }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const datePreset: string = body?.datePreset || "maximum";
    const dryRun: boolean = body?.dryRun === true;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---- Who's asking? ----
    // This route writes with the service role, so it must not be callable
    // by anyone who happens to find the URL. Verify the caller's Supabase
    // session and check the same permission that gates manual close-out.
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
    const email = userData?.user?.email ?? null;
    if (userErr || !email) {
      return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
    }

    const { data: member } = await admin
      .from("team_members")
      .select("role")
      .eq("email", email)
      .maybeSingle();

    if (!can(member?.role ?? null, "edit_performance")) {
      return NextResponse.json(
        { error: "You don't have permission to sync performance data." },
        { status: 403 }
      );
    }

    // Caller is authorized — now it's safe to report on server config.
    // Which provider runs is decided by whether a Triple Whale key exists.
    const provider = activeProvider();
    const rows: MetaInsightRow[] = [];
    let pages = 0;
    let truncated = false;
    // What gets logged as the source of this run: a Meta ad account or a shop.
    let sourceId = accountId;

    // Meta ad id -> creative thumbnail. Only Triple Whale supplies these.
    let images: Record<string, string> = {};

    if (provider === "triple_whale") {
      sourceId = process.env.TRIPLE_WHALE_SHOP_ID || "rcv9b7-p1.myshopify.com";
      try {
        const result = await fetchTripleWhaleRows(datePreset);
        rows.push(...result.rows);
        images = result.images;
      } catch (e) {
        if (e instanceof TripleWhaleError) {
          await admin.from("meta_sync_runs").insert({
            ran_by: email,
            ad_account_id: sourceId,
            date_preset: datePreset,
            error: e.message,
          });
          return NextResponse.json({ error: e.message }, { status: e.status });
        }
        throw e;
      }
    } else {
      const metaResult = await fetchMetaRows({ token, accountId, datePreset, admin, email });
      if ("error" in metaResult) {
        return NextResponse.json({ error: metaResult.error }, { status: metaResult.status });
      }
      rows.push(...metaResult.rows);
      pages = metaResult.pages;
      truncated = metaResult.truncated;
    }

    // ---- Match against the dashboard ----
    const { data: adsData, error: adsErr } = await admin
      .from("ads")
      .select("*");

    if (adsErr) {
      return NextResponse.json({ error: `Couldn't load dashboard ads: ${adsErr.message}` }, { status: 500 });
    }

    const ads = (adsData ?? []) as Ad[];
    const { matches, unmatched } = matchInsights(rows, ads);

    // ---- Write the meta_* columns (manual fields left untouched) ----
    const syncedAt = new Date().toISOString();
    let updated = 0;
    const writeErrors: string[] = [];

    // meta_ad_image_url arrives in schema v4. Probe for it once rather than
    // assuming: writing a column that doesn't exist fails every row update,
    // and a missing thumbnail is not worth breaking a sync over.
    let canWriteImage = false;
    if (Object.keys(images).length > 0) {
      const { error: probeErr } = await admin.from("ads").select("meta_ad_image_url").limit(1);
      canWriteImage = !probeErr;
    }

    if (!dryRun) {
      for (const m of matches) {
        // Several Meta ads can roll into one brief; take the first thumbnail
        // we have, which is the highest-spend variant since matchInsights
        // orders them that way.
        const image = m.metaAdIds.map((id) => images[id]).find(Boolean) ?? null;
        const { error: upErr } = await admin
          .from("ads")
          .update({
            ...(canWriteImage ? { meta_ad_image_url: image } : {}),
            meta_spend: m.spend,
            meta_purchases: m.purchases,
            meta_revenue: m.revenue,
            meta_cvr: m.cvr,
            meta_impressions: m.impressions,
            meta_clicks: m.clicks,
            meta_matched_name: m.matchedName.slice(0, 500),
            meta_matched_count: m.matchedCount,
            meta_match_method: m.method,
            meta_ad_ids: m.metaAdIds,
            meta_synced_at: syncedAt,
          })
          .eq("id", m.adId);

        if (upErr) writeErrors.push(`${m.matchedName}: ${upErr.message}`);
        else updated++;
      }

      // Persist the whole result — including the unmatched list — so the
      // Analytics panel can restore it after a reload or a server restart
      // instead of losing it with the React state.
      await admin.from("meta_sync_runs").insert({
        ran_by: email,
        ad_account_id: sourceId,
        date_preset: datePreset,
        rows_fetched: rows.length,
        ads_matched: matches.length,
        ads_updated: updated,
        unmatched_count: unmatched.length,
        unmatched,
        error: writeErrors.length ? writeErrors.join(" | ").slice(0, 1000) : null,
      });
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      syncedAt,
      provider,
      accountId: sourceId,
      datePreset,
      rowsFetched: rows.length,
      adsMatched: matches.length,
      adsUpdated: updated,
      truncated,
      unmatched,
      writeErrors,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

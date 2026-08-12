import type { MetaInsightRow } from "@/app/lib/metaMatch";

// Triple Whale as an alternative source for the same MetaInsightRow[] the
// matcher already consumes. Nothing downstream knows which provider ran —
// that separation is the whole reason this swap is a single file.
//
// Verified against The Standard Lab's account on 2026-08-12: the existing
// matcher scored 73/80 ads and 72.2% of spend on Triple Whale rows, against
// 31/75 and ~52% on Meta direct. `adset_name` carries the DTC numbers here
// exactly as it does on Meta, which is what makes that work.

const SQL_URL = "https://api.triplewhale.com/api/v2/orcabase/api/sql";
const DEFAULT_SHOP = "rcv9b7-p1.myshopify.com";
const FETCH_TIMEOUT_MS = 55_000;

// Meta's date_preset keys are the UI's vocabulary; Triple Whale wants a
// concrete range. "maximum" is capped at two years — far past the oldest
// dashboard ad, and the query aggregates server-side so the cap costs nothing.
const PRESET_DAYS: Record<string, number> = {
  maximum: 730,
  last_90d: 90,
  last_30d: 30,
  last_7d: 7,
};

// Channel name for Meta inside Triple Whale. Confirmed live — 'facebook-ads'
// carried $1,346,288 of 90-day spend against $41,918 for google-ads.
const META_CHANNEL = "facebook-ads";

export class TripleWhaleError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TripleWhaleError";
    this.status = status;
  }
}

interface TripleWhaleRow {
  ad_id?: string | number | null;
  ad_name?: string | null;
  adset_name?: string | null;
  campaign_name?: string | null;
  ad_image_url?: string | null;
  spend?: number | string | null;
  purchases?: number | string | null;
  revenue?: number | string | null;
  impressions?: number | string | null;
  clicks?: number | string | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rangeFor(datePreset: string): { startDate: string; endDate: string } {
  const days = PRESET_DAYS[datePreset] ?? PRESET_DAYS.maximum;
  // Yesterday, not today — the current day is still filling and would make
  // every sync report a partial figure that looks like a drop.
  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.getTime() - days * 86_400_000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

// Field names confirmed against a live row. Note `orders_quantity` — the
// example query in Triple Whale's own docs says `order_quantity`, which does
// not exist. The docs also warn against SELECT *, and it matters here:
// pixel_joined_tvf has 185 columns and expands to ~98KB of inlined SQL.
const QUERY = `
  SELECT
    ad_id,
    ad_name,
    adset_name,
    campaign_name,
    any(ad_image_url)    AS ad_image_url,
    SUM(spend)           AS spend,
    SUM(orders_quantity) AS purchases,
    SUM(order_revenue)   AS revenue,
    SUM(impressions)     AS impressions,
    SUM(clicks)          AS clicks
  FROM pixel_joined_tvf
  WHERE event_date BETWEEN @startDate AND @endDate
    AND channel = '${META_CHANNEL}'
  GROUP BY ad_id, ad_name, adset_name, campaign_name
`;

// Account-level daily totals — what the KPI sparklines and the
// previous-period deltas are drawn from. Deliberately not per-ad: a daily
// series for every ad would be days × ads rows, and the tiles report on the
// account, not on one brief.
const DAILY_QUERY = `
  SELECT
    event_date,
    SUM(spend)           AS spend,
    SUM(orders_quantity) AS purchases,
    SUM(order_revenue)   AS revenue,
    SUM(impressions)     AS impressions,
    SUM(clicks)          AS clicks
  FROM pixel_joined_tvf
  WHERE event_date BETWEEN @startDate AND @endDate
    AND channel = '${META_CHANNEL}'
  GROUP BY event_date
  ORDER BY event_date
`;

export interface DailyPoint {
  date: string;
  spend: number;
  purchases: number;
  revenue: number;
  impressions: number;
  clicks: number;
}

// The selected window and the equal-length window immediately before it, so
// every tile can show a delta without a second round trip from the browser.
export async function fetchTripleWhaleDaily(datePreset: string): Promise<{
  current: DailyPoint[];
  previous: DailyPoint[];
}> {
  const days = PRESET_DAYS[datePreset] ?? PRESET_DAYS.maximum;
  const curr = rangeFor(datePreset);
  const prevEnd = new Date(new Date(curr.startDate).getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - days * 86_400_000);
  const prev = {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate: prevEnd.toISOString().slice(0, 10),
  };

  const shape = (rows: Record<string, unknown>[]): DailyPoint[] =>
    rows.map((r) => ({
      date: String(r.event_date ?? ""),
      spend: num(r.spend),
      purchases: num(r.purchases),
      revenue: num(r.revenue),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
    }));

  const [current, previous] = await Promise.all([
    runSql<Record<string, unknown>>(DAILY_QUERY, curr),
    runSql<Record<string, unknown>>(DAILY_QUERY, prev),
  ]);

  return { current: shape(current), previous: shape(previous) };
}

function describeError(status: number, message: string): TripleWhaleError {
  if (status === 401) {
    return new TripleWhaleError(
      "Triple Whale rejected the API key. It may have been revoked, or it lacks the " +
        "required scope — the SQL endpoint needs Pixel Attribution: Read. Note that keys " +
        "stop working if the person who created them loses access to the workspace.",
      401,
    );
  }
  if (status === 403) {
    return new TripleWhaleError(
      "Triple Whale rejected the shop ID. Check TRIPLE_WHALE_SHOP_ID — it must be the " +
        "myshopify.com domain, not the customer-facing one.",
      403,
    );
  }
  if (status === 429) {
    return new TripleWhaleError(
      "Triple Whale is rate-limiting this key. Wait a minute and sync again — no data was changed.",
      429,
    );
  }
  if (status === 400) {
    return new TripleWhaleError(
      `Triple Whale rejected the query, which usually means their schema changed: ${message.slice(0, 300)}`,
      400,
    );
  }
  if (status === 500) {
    return new TripleWhaleError(
      "Triple Whale couldn't recognise the shop, or hit a transient failure. Try again shortly.",
      502,
    );
  }
  return new TripleWhaleError(`Triple Whale API error: ${message.slice(0, 300)}`, status >= 400 ? status : 502);
}

// One request, one place to translate failures. Returns the decoded rows.
async function runSql<T>(query: string, period: { startDate: string; endDate: string }): Promise<T[]> {
  const apiKey = process.env.TRIPLE_WHALE_API_KEY;
  if (!apiKey) {
    throw new TripleWhaleError(
      "Server is missing TRIPLE_WHALE_API_KEY. Add it in Vercel > Environment Variables (and .env.local for dev).",
      500,
    );
  }
  const shopId = process.env.TRIPLE_WHALE_SHOP_ID || DEFAULT_SHOP;

  let res: Response;
  try {
    res = await fetch(SQL_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ shopId, query, period }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    throw new TripleWhaleError(
      aborted
        ? "Triple Whale took too long to respond. Try a shorter date range."
        : "Couldn't reach Triple Whale. Check the server's network connection.",
      504,
    );
  }

  const text = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new TripleWhaleError(`Triple Whale returned a non-JSON response (HTTP ${res.status}).`, 502);
  }

  if (!res.ok) {
    const message = (payload as { message?: string })?.message || text;
    throw describeError(res.status, message);
  }

  // The endpoint returns a BARE ARRAY. Their docs document an envelope of
  // { success, message, data } — it does not come back. Reading `.data` here
  // would yield zero rows against a perfectly healthy 200, so the array form
  // is what we trust, with the envelope kept only as a fallback in case they
  // ever ship the documented shape.
  return Array.isArray(payload) ? (payload as T[]) : ((payload as { data?: T[] })?.data ?? []);
}

// Creative thumbnails ride alongside the rows rather than inside
// MetaInsightRow, so the matcher stays exactly as it is — it has no business
// knowing about images. The route joins them back on Meta ad id afterwards.
export interface ProviderRows {
  rows: MetaInsightRow[];
  images: Record<string, string>;
}

export async function fetchTripleWhaleRows(datePreset: string): Promise<ProviderRows> {
  const raw = await runSql<TripleWhaleRow>(QUERY, rangeFor(datePreset));

  const rows: MetaInsightRow[] = [];
  const images: Record<string, string> = {};
  for (const r of raw) {
    const adId = r.ad_id == null ? "" : String(r.ad_id);
    if (!adId) continue;
    if (r.ad_image_url) images[adId] = String(r.ad_image_url);
    rows.push({
      ad_id: adId,
      ad_name: r.ad_name ?? "",
      adset_name: r.adset_name ?? null,
      campaign_name: r.campaign_name ?? null,
      spend: num(r.spend),
      purchases: num(r.purchases),
      revenue: num(r.revenue),
      impressions: num(r.impressions),
      clicks: num(r.clicks),
    });
  }
  return { rows, images };
}

// Which provider a sync should use. Triple Whale wins when configured: it
// matched materially more spend in testing, and its revenue is pixel-attributed
// rather than Meta's self-report. Unset the key to fall back to Meta direct.
export function activeProvider(): "triple_whale" | "meta" {
  return process.env.TRIPLE_WHALE_API_KEY ? "triple_whale" : "meta";
}

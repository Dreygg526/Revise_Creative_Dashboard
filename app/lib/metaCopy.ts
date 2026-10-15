// Server-only: the words on a Meta ad — headlines and primary text — read
// from the ad's creative. The dashboard never stored copy (the card's
// selected_headline / selected_ad_copy are almost always empty, and the Copy
// Agent's history was never saved), so the real copy lives only in Meta.
//
// Dynamic-creative ads carry several headlines and bodies in asset_feed_spec;
// those are all returned, in Meta's order. Needs META_ACCESS_TOKEN, which
// reaches only Ad Account 12345 (~96% of recent spend): an ad in another
// account comes back with `error`, never a guess.

const VERSION = process.env.META_API_VERSION || "v25.0";

export interface AdCopy {
  headlines: string[];
  primary_texts: string[];
  descriptions: string[];
  landing_url: string | null;
  cta: string | null;
  error?: string;
}

type Text = { text?: string };
interface Creative {
  title?: string;
  body?: string;
  object_story_spec?: {
    link_data?: { name?: string; message?: string; description?: string; link?: string; call_to_action?: { type?: string; value?: { link?: string } } };
    video_data?: { title?: string; message?: string; link_description?: string; call_to_action?: { type?: string; value?: { link?: string } } };
  };
  asset_feed_spec?: { titles?: Text[]; bodies?: Text[]; descriptions?: Text[]; link_urls?: { website_url?: string }[]; call_to_action_types?: string[] };
}

const FIELDS = "creative{title,body,object_story_spec,asset_feed_spec{titles,bodies,descriptions,link_urls,call_to_action_types}}";

function uniq(list: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    const t = s?.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

function shape(c: Creative | undefined): AdCopy {
  const link = c?.object_story_spec?.link_data;
  const video = c?.object_story_spec?.video_data;
  const feed = c?.asset_feed_spec;
  return {
    headlines: uniq([c?.title, ...(feed?.titles ?? []).map((t) => t.text), link?.name, video?.title]),
    primary_texts: uniq([c?.body, ...(feed?.bodies ?? []).map((t) => t.text), link?.message, video?.message]),
    descriptions: uniq([...(feed?.descriptions ?? []).map((t) => t.text), link?.description, video?.link_description]),
    landing_url: link?.link ?? link?.call_to_action?.value?.link ?? video?.call_to_action?.value?.link ?? feed?.link_urls?.[0]?.website_url ?? null,
    cta: link?.call_to_action?.type ?? video?.call_to_action?.type ?? feed?.call_to_action_types?.[0] ?? null,
  };
}

const EMPTY = (error: string): AdCopy => ({ headlines: [], primary_texts: [], descriptions: [], landing_url: null, cta: null, error });

// One request per ad: a batched ?ids= call fails whole when any id isn't
// readable, and ads from accounts the token can't reach are routine here.
async function copyFor(adId: string, token: string): Promise<AdCopy> {
  try {
    const res = await fetch(`https://graph.facebook.com/${VERSION}/${encodeURIComponent(adId)}?fields=${FIELDS}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return EMPTY(res.status === 400 || res.status === 403 ? "Not readable with our Meta token (usually an ad outside Ad Account 12345)." : `Meta returned ${res.status}.`);
    const j = (await res.json()) as { creative?: Creative };
    const copy = shape(j.creative);
    return copy.headlines.length || copy.primary_texts.length ? copy : { ...copy, error: "Meta returned no copy for this ad." };
  } catch {
    return EMPTY("Meta didn't answer in time.");
  }
}

// Meta ad id → its copy, a few at a time so a 25-ad lookup doesn't trip
// Meta's rate limit.
export async function fetchAdCopy(adIds: string[]): Promise<Map<string, AdCopy>> {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const ids = [...new Set(adIds.filter((id) => /^\d+$/.test(id)))];
  const out = new Map<string, AdCopy>();
  if (!token) {
    for (const id of ids) out.set(id, EMPTY("META_ACCESS_TOKEN isn't set on the server."));
    return out;
  }
  for (let i = 0; i < ids.length; i += 6) {
    const chunk = ids.slice(i, i + 6);
    const got = await Promise.all(chunk.map((id) => copyFor(id, token)));
    chunk.forEach((id, k) => out.set(id, got[k]));
  }
  return out;
}

// Server-only: a public Facebook link for a Meta ad, for people who can't open
// Ads Manager (Mickey, 2026-10-14: "they cannot access the ad manager at all").
//
// Prefers the ad's preview_shareable_link (fb.me/…, opens the ad as it shows in
// the feed, no login needed), then the post itself (creative's
// effective_object_story_id = "<page>_<post>"). Needs META_ACCESS_TOKEN, which
// reaches only Ad Account 12345 (~96% of recent spend): ads in other accounts,
// or any lookup that fails, get no link rather than a broken one.

const VERSION = process.env.META_API_VERSION || "v25.0";

async function linkFor(adId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${VERSION}/${encodeURIComponent(adId)}?fields=preview_shareable_link,creative{effective_object_story_id}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { preview_shareable_link?: string; creative?: { effective_object_story_id?: string } };
    if (j.preview_shareable_link && /^https:\/\//.test(j.preview_shareable_link)) return j.preview_shareable_link;
    const story = j.creative?.effective_object_story_id?.match(/^(\d+)_(\d+)$/);
    return story ? `https://www.facebook.com/${story[1]}/posts/${story[2]}` : null;
  } catch {
    return null;
  }
}

// Meta ad id → public link (or null), looked up in parallel.
export async function facebookAdLinks(adIds: string[]): Promise<Map<string, string | null>> {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const ids = [...new Set(adIds.filter((id) => /^\d+$/.test(id)))];
  const out = new Map<string, string | null>();
  if (!token) return out;
  const links = await Promise.all(ids.map((id) => linkFor(id, token)));
  ids.forEach((id, i) => out.set(id, links[i]));
  return out;
}

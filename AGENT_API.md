# Agent API

A key-authenticated door into the dashboard for machines — built for Axel's
OpenClaw, which reads what's waiting in the pipeline and launches those ads to
Meta on its own.

Everything else in the app authenticates a **Supabase browser session**. A bot
has no session, so this is a separate entrance with a separate secret.

## What it can and can't do

| | |
|---|---|
| Read ads by pipeline stage | yes |
| Write back a Meta ad id | yes — that one column, nothing else |
| Change stage, spend, assignments, briefs | **no** |
| Delete anything | **no** |
| Read team members, settings, logins | **no** |
| Launch anything on Meta | **no** — the dashboard has no write access to Meta at all |

The response is an explicit column allow-list, not `select("*")`. Adding a
column to `ads` does **not** automatically expose it — it has to be added to
`FIELDS` in `app/api/agent/ads/route.ts` first.

## Setup

Generate a key:

```bash
node -e "console.log('rcd_'+require('crypto').randomBytes(32).toString('hex'))"
```

Add it as `AGENT_API_KEY` in **both** places:

- `.env.local` for local dev
- Vercel → Project Settings → Environment Variables (Production) for the live site

Keys shorter than 32 characters are rejected as unset, so a placeholder can't
become a working credential by accident. With no key configured every agent
request returns 401 — the integration fails closed, and the server logs
`[agent-api] AGENT_API_KEY is unset…` for the operator.

To rotate: replace the value and redeploy. The old key stops working
immediately; there is no key list to prune.

## `GET /api/agent/ads`

```bash
curl -H "Authorization: Bearer $AGENT_API_KEY" \
  "https://<your-domain>/api/agent/ads?stage=Ready%20to%20Launch"
```

`X-API-Key: <key>` works too, if that's easier to configure on the OpenClaw side.

### Query parameters

| param | default | notes |
|---|---|---|
| `stage` | `Ready to Launch` | Any pipeline stage. `*` returns every stage. |
| `dtc` | — | A single DTC number. `dtc_number` is **not unique** (#31 is duplicated), so this can return more than one ad. |
| `since` | — | ISO timestamp. Only ads updated at or after it — use it to poll for changes instead of refetching everything. |
| `limit` | `100` | 1–500. |

### Response

```json
{
  "ok": true,
  "stage": "Ready to Launch",
  "count": 3,
  "limit": 100,
  "truncated": false,
  "ads": [
    {
      "id": "8f2c…",
      "dtc_number": 142,
      "ad_name": "Gut reset — hook B",
      "product": "…",
      "format": "Video Ad",
      "selected_headline": "…",
      "selected_ad_copy": "…",
      "destination_urls": ["https://…/pdp", "https://…/advertorial"],
      "destination_url_primary": "https://…/pdp",
      "frame_io_link": "https://f.io/…",
      "assigned_media_buyer": "Axel",
      "meta_ad_id": null,
      "updated_at": "2026-08-17T…",
      "creative_asset": {
        "location": "frame.io",
        "link": "https://f.io/…",
        "note": "Link only. The dashboard does not store the video or image file."
      }
    }
  ]
}
```

`truncated: true` means there were at least `limit` matches — page with a
higher `limit` or a tighter `since`.

### The creative file is not here

This is the one thing likely to trip up the launcher. **The dashboard stores a
link to Frame.io, never the video or image itself.** To upload a creative to
Meta you need the actual bytes, which means Frame.io credentials on the
OpenClaw side. `destination_url_primary` and the copy fields come straight
from us; the asset does not.

### Ad naming

If the launcher names ads freely, our spend tracking loses them. This account's
convention puts the DTC number on the **ad set** name (77.7% of spend) more
often than the ad name (21.5%):

```
adset: DTC #82 || Static Ad || The Standard Lab || Imitation || Editor: Matt
ad:    VARIATION 3 II PDP BB
```

Any `DTC #82` / `DTC#82` / `DTC-82` form parses. Bare `BATCH#27` numbering does
**not** — batch numbers are a different sequence and are deliberately ignored
rather than guessed at.

## `POST /api/agent/ads/{id}/meta-ad-id`

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"meta_ad_id":"120210000000000000"}' \
  "https://<your-domain>/api/agent/ads/8f2c…/meta-ad-id"
```

`id` is the `id` field from the GET response (a UUID), not the DTC number.

Send `meta_ad_id` as a **string** — Meta ad ids are longer than JSON numbers
can represent exactly, so a numeric value is rejected rather than stored with
lost precision. `null` clears the field.

**Why bother:** `ads.meta_ad_id` is the top-precedence rule in the matcher,
ahead of every name-parsing fallback. Posting the real id turns spend
attribution for that ad from inference into fact — and it's the escape hatch
for ads whose names don't carry a DTC number at all.

## Errors

| status | meaning |
|---|---|
| 400 | Bad parameter — the message says which |
| 401 | Missing or wrong key |
| 404 | No ad with that id |
| 500 | Server misconfigured or database error |

401 reads the same whether the key is wrong or the server has none configured,
so a prober can't learn whether the integration is switched on.

## Operational notes

- **Poll, don't hammer.** Every 5–15 minutes is plenty; ads reach Ready to
  Launch a few times a day, not a few times a minute.
- **OpenClaw reads untrusted input.** It takes instructions from WhatsApp and
  Discord messages, so a crafted message could try to make it call this API in
  ways nobody intended. That's why the key can't move stages or delete: the
  blast radius of a hijacked agent is reading a list and writing one id.
- **The key is a full read of the pipeline.** Treat it like a password. If it
  leaks, rotate it — see Setup.

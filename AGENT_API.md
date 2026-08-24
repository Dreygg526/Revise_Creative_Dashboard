# Agent API

A key-authenticated door into the dashboard for machines — built for Axel's
OpenClaw, which reads what's waiting in the pipeline and launches those ads to
Meta on its own.

Everything else in the app authenticates a **Supabase browser session**. A bot
has no session, so this is a separate entrance with a separate secret.

## Quick start

**Base URL:** `https://revise-creative-dashboard.vercel.app`

Every request carries the same header. One key, read and write:

```
Authorization: Bearer <AGENT_API_KEY>
```

Three calls, that's the whole API:

| what | call |
|---|---|
| read the queue | `GET /api/agent/ads?stage=Testing` |
| record the Meta ad id you launched | `POST /api/agent/ads/{id}/meta-ad-id` |
| rank it Winner / Killed | `POST /api/agent/ads/{id}/result` |

`{id}` is always the `id` UUID from the GET response — **not** the DTC number.

### Check your write access in 10 seconds

This clears a verdict that is already empty, so it changes nothing. A
`{"ok": true}` back means the key can write:

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"result":null}' \
  "https://revise-creative-dashboard.vercel.app/api/agent/ads/677e870c-b0cb-453a-81b9-8ebe0087a394/result"
```

If that returns `401`, the key is wrong. If it returns a plain HTML 404 page
rather than `{"error":"No ad with that id."}`, you're pointed at the wrong
host. Anything else, jump to Errors at the bottom.

## What it can and can't do

| | |
|---|---|
| Read ads by pipeline stage | yes |
| Write back a Meta ad id | yes |
| Rank an ad Winner / Killed, with a learning | yes |
| Close an ad out (stage → `Winner / Killed`) | yes — that stage only, never any other |
| Move an ad anywhere else in the pipeline | **no** |
| Change spend, assignments, briefs, titles | **no** |
| Delete anything | **no** |
| Read team members, settings, logins | **no** |
| Launch anything on Meta | **no** — the dashboard has no write access to Meta at all |

The response is an explicit column allow-list, not `select("*")`. Adding a
column to `ads` does **not** automatically expose it — it has to be added to
`FIELDS` in `app/api/agent/ads/route.ts` first.

## Setup

*Operator side — whoever runs the dashboard does this once. If you're
consuming the API, skip to the endpoints below; you just need the key.*

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

Then run `agent_result_schema.sql` against the Supabase project. It only adds
the two attribution columns behind `POST .../result`; the endpoint works
without it, it just can't tell agent-set verdicts from human ones.

## `GET /api/agent/ads`

```bash
curl -H "Authorization: Bearer $AGENT_API_KEY" \
  "https://revise-creative-dashboard.vercel.app/api/agent/ads?stage=Ready%20to%20Launch"
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
      "stage": "Ready to Launch",
      "result": null,
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

### Fields that are empty in practice

Measured across all 126 ads on 2026-08-24. Some fields exist in the schema but
nobody fills them in, so don't design around them:

| field | filled | |
|---|---|---|
| `selected_headline` | **0/126** | never used — write your own copy |
| `selected_ad_copy` | **0/126** | same |
| `script_hook` | **0/126** | same |
| `assigned_media_buyer` | **0/126** | can't route by media buyer yet |
| `result` | **0/126** | nothing has ever ranked an ad — see the result endpoint |
| `meta_ad_id` | **0/126** | never written back yet — see the meta-ad-id endpoint |
| `frame_io_link` | 97/126 — **23 of the 24** in Ready to Launch | see below |
| `destination_url_primary` | 120/126 — **24/24** in Ready to Launch | safe to depend on |
| `brief_link` | 125/126 | safe to depend on |

Current pipeline: 74 Testing, 24 Ready to Launch, 12 Brief, 8 Review,
8 In Production.

**Still check `frame_io_link` before launching.** It's much better than it was
(12 of 19 on 2026-08-17, 23 of 24 now), but an ad with no creative link is
something to skip and report, not fail silently on.

**These ratios go stale fast** — the pipeline turned over from 99 ads to 126 in
a week, and Ready to Launch has read anywhere from 8 to 27 on a given day.
Re-measure with `GET /api/agent/ads?stage=*&limit=500` rather than trusting
this table.

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
  "https://revise-creative-dashboard.vercel.app/api/agent/ads/8f2c…/meta-ad-id"
```

`id` is the `id` field from the GET response (a UUID), not the DTC number.

Send `meta_ad_id` as a **string** — Meta ad ids are longer than JSON numbers
can represent exactly, so a numeric value is rejected rather than stored with
lost precision. `null` clears the field.

**Why bother:** `ads.meta_ad_id` is the top-precedence rule in the matcher,
ahead of every name-parsing fallback. Posting the real id turns spend
attribution for that ad from inference into fact — and it's the escape hatch
for ads whose names don't carry a DTC number at all.

## `POST /api/agent/ads/{id}/result`

Rank an ad **Winner** or **Killed** once you've seen how it performed.

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"result":"Winner","learning":"Hook B held to 3s at 2.1x ROAS over 9 days.","close":true}' \
  "https://revise-creative-dashboard.vercel.app/api/agent/ads/8f2c…/result"
```

### Body

| field | required | notes |
|---|---|---|
| `result` | yes | `"Winner"` or `"Killed"`. `null` clears it. |
| `learning` | no | Free text, max 2000 chars — one or two sentences on *why*. Omit the field to leave any existing learning alone; send `null` to clear it. |
| `close` | no | `false` by default. `true` also moves the ad to the `Winner / Killed` stage. |

**The word is `Killed`, not `Loser`** — that exact spelling is what the
Learnings view, Reports and the pipeline badge match on. You can send
`loser`, `looser`, `lost`, `win`, `w`, `l` and so on; they're normalised to
`Winner` / `Killed` and the response tells you what it stored:

```json
{ "normalized": { "from": "Looser", "to": "Killed" } }
```

Anything not in that list is a **400**, not a guess — a typo won't quietly
write a value no screen can see.

### `close`: tag vs. close out

- **`close` omitted** — writes the verdict and leaves the ad where it is. Use
  this while a test is still running and you're calling it early, or if you
  want a person to do the final close-out.
- **`close: true`** — also moves the ad to `Winner / Killed`, the last stage.
  This is the only stage value this API can ever write; there is no way to
  push an ad to `Brief`, `Testing` or anywhere else through it.

Closing without a `learning` works but comes back with a warning: the
Learnings view only lists closed ads that have one, so the ad won't show up
there.

### Response

```json
{
  "ok": true,
  "ad": {
    "id": "8f2c…",
    "dtc_number": 142,
    "ad_name": "Gut reset — hook B",
    "stage": "Winner / Killed",
    "result": "Winner",
    "learning": "Hook B held to 3s at 2.1x ROAS over 9 days."
  },
  "normalized": null,
  "stage_changed": { "from": "Testing", "to": "Winner / Killed" },
  "previous_result": null,
  "attribution_recorded": true,
  "warnings": []
}
```

`stage_changed` is `null` when the stage didn't move. `previous_result` lets
you see whether you're overwriting a verdict — including one a person set, so
re-posting is safe to make idempotent on your side.

### Every write is stamped

Agent-set verdicts are recorded as `result_source = 'agent'` with a
`result_set_at` timestamp; verdicts a person sets in the dashboard leave those
null. If a ranking run turns out to be wrong, its writes can be found and
reverted as a group without touching anyone's manual close-outs.

That needs `agent_result_schema.sql` to have been run. If it hasn't, the write
still succeeds and the response carries `attribution_recorded: false` plus a
warning.

### Why this matters more than it looks

Before this endpoint, **no ad had ever carried a result** — still 0 of 126
as of 2026-08-24. That's why the Learnings view is empty and why the Win rate
column was pulled out of Analytics — not bugs, just a field nobody filled.
Ranking ads through here brings all of that back to life, which is the
"accurate tracking" half of the loop.

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
  ways nobody intended. That's why the writes are shaped the way they are: the
  worst a hijacked agent can do is read the pipeline, write a wrong Meta ad id,
  and mislabel outcomes — all of it reversible from the dashboard, and the
  mislabelling is stamped `result_source = 'agent'` so it can be found. It
  still cannot move work through the pipeline, edit a brief, or delete.
- **The key is a full read of the pipeline.** Treat it like a password. If it
  leaks, rotate it — see Setup.

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

Four calls, that's the whole API:

| what | call |
|---|---|
| read the queue | `GET /api/agent/ads?stage=Testing` |
| record the Meta ad id you launched | `POST /api/agent/ads/{id}/meta-ad-id` |
| move it forward a stage | `POST /api/agent/ads/{id}/stage` |
| rank it Winner / Killed, with its numbers | `POST /api/agent/ads/{id}/result` |

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
| Write spend / purchases / CVR | yes — the close-out numbers, same three the modal asks for |
| Close an ad out (stage → `Winner / Killed`) | yes |
| Move an ad **forward** through the pipeline | yes — gates enforced, same as a person |
| Move an ad **backward** through the pipeline | **no** — a person has to do that in the dashboard |
| Change assignments, briefs, titles, due dates | **no** |
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
      "spend": null,
      "purchases": null,
      "cvr": null,
      "learning": null,
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

**You can read back everything you can write.** `result`, `spend`,
`purchases`, `cvr` and `learning` all come back here so a poller can tell what
it already recorded and skip it — without that, every run re-writes the same
verdict. What is *not* here is the Meta sync's own roll-up (`meta_spend`,
`meta_revenue`, `meta_breakdown` and friends): the key can't write those, and
you have the raw Meta numbers on your side already. CPA isn't a column
anywhere — it's `spend / purchases`, computed wherever it's shown.

### Fields that are empty in practice

Measured across all 150 ads on 2026-08-26. Some fields exist in the schema but
nobody fills them in, so don't design around them:

| field | filled | |
|---|---|---|
| `selected_headline` | **0/150** | never used — write your own copy |
| `selected_ad_copy` | **0/150** | same |
| `script_hook` | **0/150** | same |
| `assigned_media_buyer` | **0/150** | can't route by media buyer yet |
| `result` | **0/150** | nothing has ever ranked an ad — see the result endpoint |
| `spend` / `purchases` / `cvr` | **0/150** | nobody closes ads out by hand either |
| `learning` | **0/150** | same — which is why the Learnings view is empty |
| `meta_ad_id` | **0/150** | never written back yet — see the meta-ad-id endpoint |
| `frame_io_link` | 117/150 — **45 of the 52** in Ready to Launch | see below |
| `destination_url_primary` | 144/150 — **52/52** in Ready to Launch | safe to depend on |
| `brief_link` | 149/150 | safe to depend on |

Current pipeline: 74 Testing, 52 Ready to Launch, 12 Brief, 10 In Production,
2 Review.

**Still check `frame_io_link` before launching** — 7 of the 52 ads in Ready to
Launch have no creative link. That's something to skip and report, not fail
silently on.

**These ratios go stale fast** — the pipeline went 99 → 126 → 150 ads in ten
days, and Ready to Launch has read anywhere from 8 to 52 on a given day.
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

Rank an ad **Winner** or **Killed** once you've seen how it performed, and
record the numbers behind that call.

This is the machine equivalent of the dashboard's close-out form, and takes
the same five fields it does: outcome, spend, purchases, CVR, learning.

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"result":"Winner","spend":412.55,"purchases":6,"cvr":1.8,"learning":"Hook B held to 3s at 2.1x ROAS over 9 days.","close":true}' \
  "https://revise-creative-dashboard.vercel.app/api/agent/ads/8f2c…/result"
```

### Body

| field | required | notes |
|---|---|---|
| `result` | — | `"Winner"` or `"Killed"`. `null` clears it. |
| `spend` | — | Ad spend, currency amount. `412.55` |
| `purchases` | — | Whole number of purchases. `6` |
| `cvr` | — | **A percentage, not a fraction.** `1.8` means 1.8%. Values above 100 are rejected. |
| `learning` | — | Free text, max 2000 chars — one or two sentences on *why*. |
| `close` | — | `false` by default. `true` also moves the ad to the `Winner / Killed` stage. |

**Nothing is individually required — but send at least one of `result`,
`spend`, `purchases`, `cvr`, `learning`.** Any field you omit is left exactly
as it was, so you can post numbers now and a verdict later, or update spend
mid-test without touching the verdict. Sending `null` clears that one field.

**Don't send `cpa`.** It isn't stored anywhere in this app — it's computed as
`spend / purchases` wherever it's displayed, so posting it is a 400. The
response echoes the computed value back to you.

**Unknown fields are rejected, not ignored.** `{"roas": 2.1}` gets a 400
naming the field. Better than a `200` that wrote nothing.

**These write the manual close-out columns, not the Meta sync's.** The
dashboard prefers its own synced `meta_spend` / `meta_purchases` / `meta_cvr`
where it has them, and falls back to what you send here — the same precedence
a human close-out gets. Your numbers are never overwritten by a sync, they're
just outranked on screen where Meta has its own figure for that ad.

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
  This is the only stage value *this* endpoint can write; ordinary pipeline
  moves go through `POST .../stage` below.

`close: true` needs a verdict, either in the same request or already on the
ad. It does **not** need the numbers — but closing without `spend`,
`purchases` or `cvr` comes back with a warning naming what's missing, because
that's a state a person couldn't have produced (the dashboard's close-out
form demands all three). Same for a missing `learning`: the Learnings view
only lists closed ads that have one, so the ad won't show up there.

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
    "spend": 412.55,
    "purchases": 6,
    "cvr": 1.8,
    "cpa": 68.76,
    "learning": "Hook B held to 3s at 2.1x ROAS over 9 days."
  },
  "written": ["result", "spend", "purchases", "cvr", "learning"],
  "normalized": null,
  "stage_changed": { "from": "Testing", "to": "Winner / Killed" },
  "previous_result": null,
  "attribution_recorded": true
}
```

`written` lists the fields this request actually set, so you can confirm the
body parsed the way you meant. `cpa` is computed, never stored.
`stage_changed` is `null` when the stage didn't move. `previous_result` lets
you see whether you're overwriting a verdict — including one a person set, so
re-posting is safe to make idempotent on your side. `warnings` is present only
when there's something to say.

### Every write is stamped

Agent-set verdicts are recorded as `result_source = 'agent'` with a
`result_set_at` timestamp; verdicts a person sets in the dashboard leave those
null. The stamp tracks the **verdict**, so a metrics-only call comes back
`attribution_recorded: false` — it didn't touch the verdict, and re-dating
someone else's close-out because you updated spend would be wrong. If a ranking run turns out to be wrong, its writes can be found and
reverted as a group without touching anyone's manual close-outs.

That needs `agent_result_schema.sql` to have been run. If it hasn't, the write
still succeeds and the response carries `attribution_recorded: false` plus a
warning.

### Why this matters more than it looks

Before this endpoint, **no ad had ever carried a result** — still 0 of 150
as of 2026-08-26, and the same is true of spend, purchases, CVR and learning. That's why the Learnings view is empty and why the Win rate
column was pulled out of Analytics — not bugs, just a field nobody filled.
Ranking ads through here brings all of that back to life, which is the
"accurate tracking" half of the loop.

## `POST /api/agent/ads/{id}/stage`

Move an ad forward through the pipeline — the call to make once you've
actually launched something, so it doesn't sit in Ready to Launch waiting for
a person to tick a box for work you already did.

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"stage":"Testing"}' \
  "https://revise-creative-dashboard.vercel.app/api/agent/ads/8f2c…/stage"
```

### Body

| field | required | notes |
|---|---|---|
| `stage` | yes | One of the seven stages below. Case-insensitive, and the separator in `Winner / Killed` doesn't matter. |

The pipeline, in order:

```
Idea → Brief → In Production → Review → Ready to Launch → Testing → Winner / Killed
```

Anything outside that list is a **400** with the valid stages in the response —
stages are a fixed vocabulary, and a near-miss like `"testing "` or `"Live"`
would create a board column no filter can reach.

### Forward only

**A move to an earlier stage is a 403.** This is the one real bound left on
the key: an agent that can rewind can quietly undo the team's work and leave
the board lying about where things stand. If something needs to go backwards,
a person does it in the ad detail modal.

Posting the stage an ad is already in is **not** an error — it comes back
`{"ok": true, "moved": false}`, so a retrying poller is safe.

Skipping stages is allowed (`Brief` → `Testing`), but every gate in between is
checked and `skipped_stages` in the response names what you jumped.

### Gates apply, exactly as they do for a person

Each forward step has prerequisites. If they aren't met you get a **409**
naming the missing fields:

```json
{
  "error": "Can't move \"Ready to Launch\" -> \"Testing\": Destination URL missing.",
  "from": "Ready to Launch",
  "to": "Testing",
  "missing": ["Destination URL"]
}
```

| leaving | needs |
|---|---|
| `Idea` | Persona, Core Emotion, Problem, Awareness |
| `Brief` | Brief link + Editor — *skipped entirely if the strategist is also the editor (a self-produced ad)* |
| `In Production` | nothing |
| `Review` | nothing |
| `Ready to Launch` | at least one destination URL |
| `Testing` | Result, Spend, Purchases, CVR, Learning — **all five**, which is why `POST .../result` exists |

A 409 is a real answer, not a failure — it's telling you the ad isn't ready.
Read `missing`, report it, move on to the next ad. `Ready to Launch` →
`Testing` is the one you'll live on, and its only requirement is the
destination URL, which all 52 ads in that stage currently have.

**To close an ad out, use `POST .../result` with `close: true`, not this
endpoint.** Reaching `Winner / Killed` through here means satisfying the full
five-field gate first — so you'd have to call `.../result` anyway. This
endpoint won't refuse it, but it'll warn you.

### Response

```json
{
  "ok": true,
  "ad": { "id": "8f2c…", "dtc_number": 142, "ad_name": "Gut reset — hook B", "stage": "Testing" },
  "moved": true,
  "stage_changed": { "from": "Ready to Launch", "to": "Testing" },
  "skipped_stages": []
}
```

### The full launch loop

The four calls in the order OpenClaw actually makes them:

1. `GET /api/agent/ads?stage=Ready%20to%20Launch` — what's waiting. Skip any
   ad with no `frame_io_link` and report it.
2. Launch it on Meta yourself.
3. `POST /api/agent/ads/{id}/meta-ad-id` — hand back the id Meta returned.
   This turns attribution for that ad from name-parsing guesswork into fact.
4. `POST /api/agent/ads/{id}/stage` with `{"stage":"Testing"}` — the ad is now
   live, so the board should say so.

Then, days later, when the test has run:

5. `POST /api/agent/ads/{id}/result` with the verdict, `spend`, `purchases`,
   `cvr`, a `learning`, and `close: true`.

## Errors

| status | meaning |
|---|---|
| 400 | Bad parameter or unrecognized field — the message says which |
| 401 | Missing or wrong key |
| 403 | Refused by policy — currently only a backward stage move |
| 404 | No ad with that id |
| 409 | The ad isn't in a state that allows this — a gate is unmet. `missing` says what's needed |
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
  mislabel outcomes, mis-state performance numbers, and push ads *forward* into
  stages they aren't ready for — all of it reversible from the dashboard, and
  the mislabelling is stamped `result_source = 'agent'` so it can be found. It
  still cannot pull work backwards, edit a brief, reassign anyone, or delete.
  Gate enforcement on the stage endpoint means it can't advance an ad past a
  requirement a person would have had to satisfy either.
- **The key is a full read of the pipeline.** Treat it like a password. If it
  leaks, rotate it — see Setup.

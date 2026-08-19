# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> **Next.js version warning (from AGENTS.md):** This repo runs Next.js 16 + React 19. APIs and conventions may differ from your training data. Consult `node_modules/next/dist/docs/` before writing framework code.

## Commands

```bash
npm run dev     # start dev server at http://localhost:3000
npm run build   # production build (also the CI/Vercel build)
npm run start   # serve the production build
npm run lint    # eslint (flat config, eslint.config.mjs)
```

There is no test suite. Verify changes by running `npm run dev` and exercising the UI, or `npm run build` to catch type/prerender errors.

`npm run lint` has a standing baseline of pre-existing errors (mostly `react-hooks/set-state-in-effect`). Compare counts before and after a change rather than expecting zero.

`app/lib/metaMatch.ts` is pure and imports only types, so it can be exercised without the app — compile it standalone and drive it from Node:

```bash
npx tsc app/lib/metaMatch.ts --outDir .scratch/mm --module esnext --target es2020 \
  --moduleResolution bundler --skipLibCheck   # the @/app/types error is expected; it still emits
node --input-type=module -e 'import("./.scratch/mm/metaMatch.js").then(m => console.log(m.extractDtcNumber("DTC 142 | 9x16")))'
```

**Use a repo-relative `--outDir`, not `/tmp`.** This is a Windows machine: Git Bash rewrites `/tmp` when it's a bare argument (so `tsc` emits to the real temp dir) but *not* inside the quoted `import(...)` string, where Node reads it as `C:\tmp` — the compile appears to succeed and the `node` line then dies with `ERR_MODULE_NOT_FOUND`. `.scratch/` is gitignored.

`app/lib/gates.ts` is pure the same way, so the same trick tests pipeline gates without logging into the app — the only practical way to check a gate change against all seven forward transitions:

```bash
npx tsc app/lib/gates.ts --outDir .scratch/gt --module esnext --target es2020 \
  --moduleResolution bundler --skipLibCheck   # same expected @/app/types error
node --input-type=module -e 'import("./.scratch/gt/gates.js").then(g =>
  console.log(g.checkMove({ assigned_strategist: "Rob", assigned_editor: "Rob" }, "Brief", "In Production")))'
# -> { allowed: true, missing: [] }   (self-produced clears the Brief gate)
```

## Environment

The app needs these env vars (Vercel: Project Settings > Environment Variables; locally: `.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-side Supabase client (`lib/supabaseClient.ts`).
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, used by `app/api/invite` and `app/api/delete-member` to call Supabase admin auth. Never expose to the client.
- `ANTHROPIC_API_KEY` — server-only, used by `app/api/generate-copy` (the Copy Agent).
- `AGENT_API_KEY` — server-only. The shared secret for `app/api/agent/*` (Axel's OpenClaw). **Anything under 32 characters is treated as unset and every agent request 401s**, so the integration fails closed rather than open. Rotate by replacing the value and redeploying; there's no key list. See `AGENT_API.md`.
- `TRIPLE_WHALE_API_KEY` — server-only. **Its presence is what selects the provider** (`activeProvider()` in `app/lib/tripleWhale.ts`): set it and syncs pull from Triple Whale, unset it and they fall back to Meta direct. Needs the `Pixel Attribution: Read` scope (plus `Summary Page: Read`); no write scope. Never expose to the client.
- `TRIPLE_WHALE_SHOP_ID` — optional, defaults to `rcv9b7-p1.myshopify.com`. Must be the `myshopify.com` domain, not the customer-facing one.
- `META_ACCESS_TOKEN` — server-only, used by `app/api/meta-sync` when no Triple Whale key is set. Long-lived (60-day) or System User token with `ads_read`. Never expose to the client.
- `META_AD_ACCOUNT_ID` — optional, defaults to `act_2223260745102430`.
- `META_API_VERSION` — optional, defaults to `v25.0`. Bump when Meta sunsets that version.
- `NEXT_PUBLIC_META_AD_ACCOUNT_ID` — optional, defaults to `act_2223260745102430`. **Browser-side, and only a fallback for Ads Manager deep links.** Links use the ad's own `account_id` from the sync; this covers rows synced before that was recorded. Not a secret — it's visible in every Ads Manager URL. See the six-account note under Architecture before touching anything that reads it.
- `NEXT_PUBLIC_META_BUSINESS_ID` — optional, defaults to `1888429485321387`. Browser-side, appended to Ads Manager links as `business_id` + `global_scope_id`. **Without it Facebook resolves `act=` in the viewer's personal scope and silently redirects to their own ad account** rather than erroring — which looks like the link being broken. Exported from `AdDetailModal.tsx` as `META_BUSINESS_ID`.

`lib/supabaseClient.ts` deliberately falls back to placeholder values and warns (rather than throwing) when the public vars are missing, so the Vercel prerender/build never crashes at module load.

## Architecture

Internal creative-ops dashboard for a DTC ad agency ("Revise"). It tracks ads through a production pipeline, gates stage transitions on required fields, enforces role-based permissions, and includes an AI copywriting tool. Backend is Supabase (Postgres + Auth); there is no custom server beyond a few Next.js route handlers.

**Single-page shell.** `app/page.tsx` is the whole app: a fixed sidebar plus one active view chosen from `NAV_ITEMS` via local `useState` (no router-based navigation between views). Each nav key maps to a component in `app/components/views/`. `app/layout.tsx` wraps everything in `AuthProvider`.

**Auth flow** (`app/hooks/useAuth.tsx`, a React context): `page.tsx` gates on it — `loading` → spinner, `needsPassword` → `SetPasswordPage`, no `session` → `LoginPage`, else the dashboard. Users are created by invite (`/api/invite`), not self-signup; invited/recovery users are detected via Supabase auth events or a `type=invite`/`type=recovery` URL hash and forced through password setup, which also flips their `team_members.status` to `active`.

**Roles & permissions are two separate systems — keep them distinct:**
- `app/lib/permissions.ts` — *who can do what*. `can(role, action)` checks a `RULES` table of `Action`s. Note the quirk: **Graphic Designer normalizes to Editor** (same permissions). This is the single source of truth for UI gating (create/edit/delete/review/manage). The logged-in user's role comes from `useMyRole()`, which looks it up in `team_members` by email. Current grants beyond Founder/Strategist: **Editor** has `create_ad`, `edit_title`, `edit_zone1`, `edit_zone2`, `move_stage`, `review_ad`; **Media Buyer** has `edit_zone2`, `move_stage`, `edit_performance`. Deletion (`delete_ad`, `batch_delete`), `manage_lists` and `self_produce` stay Founder + Strategist; `manage_team` is Founder-only. One asymmetry worth knowing: Editors can delete *ideas* (the Ideas view gates those buttons on `create_ad`) but not *ads*. **`self_produce` is deliberately not Editor** — Graphic Designer normalizes to Editor, so granting it there would also hand it to every editor and let them skip their own review handoff.
- **Ads store names, not emails, in every assignment field** (`assigned_strategist` / `assigned_editor` / `assigned_media_buyer`). Anything asking "is this mine?" has to resolve the session email to a `team_members.name` first — that's `useMyName()`, the sibling of `useMyRole()`. `MyQueueView`, `WorkloadView` and the self-produced checkbox all compare against it; don't reach for `session.user.email`.
- `app/lib/gates.ts` — *what an ad needs before it advances*. `checkMove(ad, from, to)` returns `{ allowed, missing }`. Backward/same-stage moves are always free; forward moves must satisfy every `GATES` rule between the two stages. `STAGE_ORDER` (7 stages, Idea → Winner/Killed) is the canonical pipeline order.

**Self-produced ads — `assigned_strategist === assigned_editor` is the flag.** Strategists make some creative themselves (usually statics) and were blocked by the Brief gate's `Brief link` + `Editor`, both of which exist only to hand work to a second person. `isSelfProduced()` in `gates.ts` drops both when the strategist is also the editor; the "Self-produced" checkbox in `AdDetailModal` (gated on the `self_produce` action — Founder + Strategist, deliberately **not** Editor) is what writes that. Things this encoding depends on:
- **It's a same-name comparison, not a column.** Chosen over a `self_produced` boolean so the ad carries a real person in `assigned_editor` — My Queue, Workload, Reports and `buildAdSetName()` all read that field and would each have needed to learn a sentinel. It also means no migration, and no risk of `persist()` writing a column the live DB doesn't have.
- **The Editor field renders as text, not a `<select>`, when self-produced.** `editorOptions` only lists Editors and Graphic Designers, so the strategist's own name matches no `<option>` and the dropdown would show blank.
- **It unlocks the Brief gate only.** Zone 1, destination URLs and the close-out gate are untouched — verified against all seven forward transitions.
- Ticking the box with no strategist assigned falls back to the logged-in user's name (`useMyName()`); with neither, the box is disabled rather than silently doing nothing.

**Data layer = per-entity hooks** in `app/hooks/` (`useAds`, `useIdeas`, `useLists`, `useTeam`, `useScript`, `useSettings`, `useTargets`, `useMetaSync`, `usePerfSeries`). Each owns its Supabase table: fetches on mount, exposes CRUD functions, and updates local state optimistically after each mutation. There is no global store or cache — views call these hooks directly. `useAds` also derives `nextDtcNumber()` and new ads always start at stage `"Idea"`. These hooks all trip `react-hooks/set-state-in-effect` with their fetch-on-mount effect; that's the established house pattern here, so match it rather than making one hook an outlier.

**Types** (`app/types/index.ts`) mirror the Supabase schema one-to-one (source: `phase1_schema.sql`, not in repo). The central entity is `Ad`, organized into zones: Strategy (Zone 1), Operational (Zone 2), and end-of-life Performance/Learning. Important: **`cpa` is never stored** — compute it with `calcCpa()` (`spend / purchases`). A `Learning` is just a closed `Ad` with a `learning` written; the Learnings view filters, there is no separate table. Editable dropdown values (stages, personas, roles, etc.) live in the `settings_lists` table keyed by `SettingsListType`, managed in the Settings view.

**Pipeline board filters** (`PipelineView.tsx`) — eight filters plus the free-text search, all local `useState`, `""` meaning "no filter". Three things worth preserving:
- **Dropdown options merge `settings_lists` with live ad values.** `buildOptions()` takes the canonical list order, then appends any value present on an ad but absent from the list. Without the second half, renaming or deleting a value in Settings would leave every ad still carrying it permanently unreachable by filtering.
- **Overdue is defined once, in three places.** `due_date < today && stage !== "Winner / Killed"` — the same expression `MyQueueView` and `WorkloadView` use. Change one, change all three or they'll disagree.
- **Stage headers read `3 of 12` whenever anything is narrowing** (any filter *or* a search query), so a near-empty column reads as a filter effect rather than an empty pipeline. The closed-ads modal applies the same filters, so its list can't contradict the count on the column that opened it.

**Why a correct match looks fabricated when you cross-check it.** This came up hard in review and will again — the sync gets accused of inventing data roughly once per audit. Four independent reasons a real number won't reproduce in Ads Manager or Moby:
- **Moby and the sync are different datasets.** Moby queries the live Meta entity graph, where deleted and archived ads don't exist. The sync reads `pixel_joined_tvf`, which keeps the spend of ads that are long gone. Five separate ads are named exactly `DTC #21 || Variation 3 || PDP` ($7,593 / $6,189 / $2,374 / $372 / $209), all stopped by late June — Moby reports that name "does not exist."
- **The DTC number is usually on the ad set, not the ad.** 14 of DTC #21's 64 ads carry it only there, so an *ad-name* search finds nothing. 11 of its ad sets are called `Champion Adset` with no DTC number at all and matched via the ad name instead.
- **Ad sets are not ads.** DTC #21 spans 39 ad sets holding 64 ads; this account duplicates ad sets constantly (same name, different id, note the `- Copie` suffix). Asking for "ad sets named DTC #21" returns 7 and looks like a contradiction.
- **Default date ranges are far too short.** Briefs run for months — #21 started 2026-02-06 — and only 35 ads / $12.7k of its $98.5k fall inside a last-30-days window.

**The ad naming convention changed around July 2026** — Feb–June is `DTC #21 || Variation 3 || PDP` (pipes), July onward is `DTC#21 II VARIATION 3` (capital i's, no PDP). Both still parse. What doesn't survive is dropping the `DTC #N` prefix altogether: `Variation 3 || PDP` ($542) matched only through its ad set name.

**This shop spends across SIX Meta ad accounts. Nothing may assume one.** Measured all-time, 2026-08-13:

| account | ads | spend |
|---|---|---|
| `act_1123078669636137` | 2,716 | $1,827,118 |
| `act_2223260745102430` | 611 | $540,721 |
| `act_757562620575530` | 824 | $503,838 |
| `act_1483472386914314` | 486 | $266,597 |
| `act_1254032640200871` | 17 | $1,199 |
| `act_1347280364077014` | 8 | $346 |

Consequences, all of them load-bearing:
- **`META_AD_ACCOUNT_ID` (default `act_2223260745102430`) reaches 17% of spend.** This — not attribution modelling — is most of why Meta direct matched 31 of 75 ads where Triple Whale matches 76 of 80. Meta direct queries one account per run; Triple Whale's pixel data spans all six. Anyone reviving the Meta-direct path needs to loop over accounts.
- **Ads Manager links must use the ad's own account**, carried per row on `MetaInsightRow.account_id` → `MetaBreakdownRow.account_id`. A link built against the wrong account renders Meta's "No ads found" telescope for an ad that exists, which reads exactly like the matcher inventing data. Two earlier versions of that link were wrong (Shopify domain, then one hardcoded account); `NEXT_PUBLIC_META_AD_ACCOUNT_ID` is now only a fallback for rows synced before the account was recorded.
- **Cross-checking a number in Ads Manager means picking the right account AND a wide enough date range.** "Ad Account 12345" in the account picker is `act_2223260745102430` — the small one. Worked example: DTC #21's $98,617 splits `act_1123078669636137` $71,392 (Feb 6–Jun 27), `act_2223260745102430` $12,217 (**Jul 14 onward only**), `act_757562620575530` $11,060 (Apr 25–Jun 26), `act_1483472386914314` $3,877 (Jun 21–Aug 6). The team appears to have migrated accounts over time, so any brief older than ~1 month is mostly invisible in 12345 — which is exactly how correct data comes to look invented.

**Two providers, one matcher.** `app/api/meta-sync/route.ts` fetches from either Meta direct (`fetchMetaRows()`, in the route) or Triple Whale (`app/lib/tripleWhale.ts`), both producing the same `MetaInsightRow[]`. Everything downstream — matcher, Analytics UI, `meta_*` columns, `effectivePerf()` — is provider-agnostic and was not touched to add Triple Whale. Things to know before editing `tripleWhale.ts`:
- **The SQL endpoint returns a bare JSON array**, not the `{ success, message, data }` envelope its own docs specify. Reading `.data` gives zero rows against a healthy `200` — a silent failure that looks like "no data found".
- The column is **`orders_quantity`**; the example query in Triple Whale's docs says `order_quantity`, which does not exist. `pixel_joined_tvf` takes no arguments despite the name, holds 185 columns, expands to ~98KB of inlined SQL (hence nonsense column positions in syntax errors), and runs on ClickHouse.
- Date params must be **camelCase** `@startDate` / `@endDate` over the API. The `@start_date` form works only in their in-app SQL Builder and fails here.
- `channel = 'facebook-ads'` is the Meta filter. Verified 2026-08-12: Meta $1.35M of 90-day spend vs $41.9k google-ads.
- The window ends **yesterday**, not today — the current day is still filling and would read as a drop on every sync.
- `pixel_joined_tvf` also carries **`ad_image_url`** (used for thumbnails), plus `creative_format`, `creative_cta_type`, `country`, `outbound_clicks`, video quartiles and `creative_id` — those last ones are unused so far.
- **`account_id` is on every row** and must be carried through, not assumed. See the six-account note above.

**Data-availability note (probed 2026-08-13, worth knowing before promising any panel):** `pixel_joined_tvf` has **no** `age`, `gender`, `publisher_platform`, `link_clicks`, or engagement columns, and no `headline` / `body` / `landing_page`. Meta's Insights API has all of them via `breakdowns` — but the configured `META_ACCESS_TOKEN` reaches only `act_2223260745102430` and `act_1483472386914314` ($807k of $3.14M), so anything built on it would cover a quarter of spend. Also measured: on `act_2223260745102430` over 14 days, Meta reports ROAS 0.79 / CPC-link $2.36 / CPM $32.65 / AOV $52.94 against Atria's 0.79 / $2.36 / $32.63 / $52.96 — Atria simply *is* that one ad account through Meta's API, which is why its numbers never matched our whole-store figures.

**Analytics overview** (`app/components/analytics/AnalyticsOverview.tsx`) — the Atria-style panels above the drill-down table: Key Metrics tiles, Top Creative Tags, Top Spend. Page order is deliberately controls → table → overview; the table is what people came to read.
- **Key Metrics are account-level and carry their own window**, independent of the sync date preset (`usePerfSeries` → `/api/perf-series` → `fetchTripleWhaleDaily`). This is not an oversight: syncing wants `maximum` for the best match coverage, but an all-time window has **no preceding window**, which is exactly how the previous-period line renders invisible. The KPI selector only offers 7/30/90d for that reason. The tiles say "whole ad account" on them because the matched/unmatched filter deliberately doesn't touch them — the tag panels and Top Spend below *are* filtered.
- **Window totals are computed from summed components, never by averaging the daily ratios** — mean-of-ratios weights a $200 day the same as a $20k one. Same rule as blended CVR.
- **Sparklines pad the y-domain by 55% of span.** Without it every series is stretched floor-to-ceiling, so a metric that moved 2% looks as violent as one that moved 200%. They're Catmull-Rom curves, and gaps break the line rather than being bridged — a day with no denominator is an absence, not a plunge to zero.
- **Bars are one hue.** Colouring rows individually would encode rank, so hues would reshuffle whenever a filter changed. The only two-series chart is Top Spend, where blue/orange (`#3987e5` / `#d95926`) is used because it clears every colour-vision check on this dark ground — Atria's purple/teal fails the lightness band here.
- **Top Spend is a genuine dual-axis chart**, built that way on explicit instruction after the trade-off was raised. The two bar heights are *not* comparable to each other; the caption on the chart says so. Only additive measures are bar-chartable elsewhere (Spend/Revenue/Purchases) — ROAS and CPA ride as text, since bar length encoding a ratio would let a $300 ad outrank a $50k one.
- **Bars, thumbnail and label for one ad must live in one column element.** An earlier version put bars and thumbnails in two sibling flex rows; they computed different widths and the thumbnails drifted out of line with their bars.
- `overflowX: "auto"` on the chart makes the **vertical** axis clip too — hence the explicit `paddingTop`, without which the top gridline label and the tallest bar's value get cut in half.

**Meta Ads sync** — auto-fills performance instead of hand entry, without destroying hand entry:

- **The DTC number lives on the Meta AD SET, not the ad name.** This account's real convention is `adset = "DTC #82 || Static Ad || The Standard Lab || Imitation || Editor: Matt"` while `ad = "VARIATION 3 II PDP BB"` — the ad set is the brief, the ads under it are creative variants. Measured coverage of total spend: ad name 21.5%, **ad set 77.7%**, campaign 0%. Matching only on ad names attributes about a fifth of spend; this is the single most important fact about this integration.
- `app/lib/metaMatch.ts` is the pure matching layer (no I/O — easy to test in isolation). Precedence per Meta row: `ads.meta_ad_id` override → DTC number parsed from the **ad name** → from the **ad set name** → from the **campaign name** → unambiguous `ad_name` text match. It takes the first candidate that resolves to a real dashboard ad, so a stale number on one field falls through to another. Several Meta ads legitimately map to one DTC number (variants, `.1`/`.2` iterations, relaunches, duplicated ad sets) and are **summed**. Everything unmatched comes back with a human-readable reason — nothing fails silently.
- `extractDtcNumber()` accepts `DTC 142`, `DTC#142`, `DTC-142`, `dtc_142`, `DTC142`, and a bare leading `142_…` / `#142 …`. A bare leading number requires a following separator so aspect ratios don't parse as DTC numbers (`9x16_sleepangle` must not read as DTC #9). `BATCH#27`-style names are deliberately **not** parsed — batch numbers are a different sequence, and guessing would attribute spend to the wrong brief.
- Decimal DTCs collapse into their parent: `DTC #11`, `#11.1`, `#11.2` all roll into dashboard DTC `11`. Correct if `.1` means "iteration of the same brief" — revisit if that changes.
- `app/api/meta-sync/route.ts` pulls `level=ad` insights, paginating up to 25 pages. **Order matters:** it verifies the caller's Supabase session and `edit_performance` permission *before* reporting anything about server config, so an anonymous caller can't probe env state. It holds the service-role key, so it must never be openly callable. Meta error codes are translated to actionable messages: 190 → token expired, 4/17/613 → rate limited, 200/10 → missing `ads_read`, 100 → bad params.
- Purchases come from Meta's `actions[]` array and revenue from `action_values[]`, both taking the **first** of `omni_purchase` → `purchase` → `offsite_conversion.fb_pixel_purchase` (`extractPurchaseMetric()` handles both — same keys, same first-match-wins rule). Meta returns all three types with the same value; summing them would triple-count.
- **ROAS and AOV are derived, never stored** — same rule as CPA. Only `meta_revenue` is persisted. ROAS is revenue ÷ ad spend and is **margin-blind**: 1x means the ad spend came back, not that anything was profitable. The UI says so explicitly; don't let it read as a profit metric.
- **Meta values never overwrite manual ones.** They land in `meta_*` columns; `effectivePerf()` in `app/types/index.ts` prefers Meta when present and falls back to the close-out entry. `meta_cpa` is not stored — CPA stays computed, same rule as everywhere else.
- **CVR is blended, not averaged.** Analytics computes total purchases ÷ total link clicks per group. Averaging per-ad CVR gives a 5-click ad the same weight as a 5,000-click one (it read 1.84% where the true blended rate was 1.99%). CPA was already blended; keep the two consistent.
- Triggered by the "Sync from Meta" button in `AnalyticsView`; the route is cron-ready if you later want it scheduled. Each run is logged to `meta_sync_runs` **including the full unmatched list as JSON**, and `useLastSyncRun()` restores it on mount so the result panel survives a reload or restart.
- Analytics rows expand to the ads inside them; each ad opens `AdDetailModal` or deep-links into Ads Manager via `meta_ad_ids`. A matched/unmatched filter drives both the table and the totals row. **Expanded child rows must be `<tr>`s in the same `<table>` as their parent** — an earlier version nested a second `<table>` inside a `colspan` cell, which got its own column widths and silently rendered every number under the wrong header.
- Schema lives in **five** files, run in order: `meta_integration_schema.sql` → `_v2.sql` → `_v3.sql` → `_v4.sql` → `_v5.sql`. v2 adds `ads.meta_ad_ids` and `meta_sync_runs.unmatched`; v3 adds `ads.meta_revenue`; v4 adds `ads.meta_ad_image_url`; v5 adds `ads.meta_breakdown`. The route writes v1–v3 unconditionally, so syncing before running those fails every row update. **v4 and v5 are the exceptions** — the route probes for each column with a `select … limit 1` and omits it when absent, so a missing v4 costs you thumbnails and a missing v5 costs you the per-ad breakdown, rather than the whole sync. Copy that pattern for future columns.
- **The roll-up is auditable from the ad detail modal.** A brief's `meta_*` numbers sum every Meta ad carrying its DTC number — DTC #21 sums 70 of them, which is correct and also unreadable, since one blended CPA over 70 creatives hides both the winner and the dead weight. `ads.meta_breakdown` (v5) stores the contributing rows, spend-sorted and capped at 200, and `MetaBreakdown` in `AdDetailModal.tsx` expands them. It leads with a **by-DTC-variant** split (only when the names disagree about the decimal), because that is the one view that shows what the decimal-collapsing assumption is costing — `extractDtcVariant()` keeps the un-collapsed token (`"21.1"`) purely for this; it has no effect on matching.
- **`matchInsights()` sorts each roll-up by spend, highest first**, and derives `metaAdIds` / `matchedName` from that order. The route's thumbnail pick already assumed this ordering; before the breakdown work nothing actually established it, so the thumbnail was whichever row the provider happened to page first.
- Known data gaps (not code bugs) are listed under Project status below; `dtc_number` is **not unique** — #31 is duplicated, and the matcher keeps only the first.

**API routes** (`app/api/*/route.ts`) exist only for operations that need a secret key server-side: `invite` and `delete-member` (Supabase service-role admin), `generate-copy` (Anthropic), `meta-sync` (Meta / Triple Whale), and `perf-series` (Triple Whale daily totals for the KPI sparklines — read-only, so it verifies the session but doesn't require `edit_performance`). `generate-copy` holds a large server-side "copy DNA" prompt library and calls the Messages API directly via `fetch`; it must return raw JSON parseable into `{ headlines, ad_copies }`.

**Two ways to authenticate a route, both in `app/lib/apiAuth.ts`.** `requireMember(req, admin, action)` verifies a Supabase session token and checks `can(role, action)` — every browser-facing route uses it. `requireAgentKey(req)` compares a shared secret against `AGENT_API_KEY` and is only for machines. Both return a discriminated union and both must run **before** the route reports anything about server config, so an anonymous caller can't probe env state.

**Agent API** (`app/api/agent/*`) — the door for Axel's OpenClaw, which reads what's waiting in the pipeline and launches those ads to Meta on its own. Full docs for the consumer live in `AGENT_API.md`. What matters here:
- **`GET /api/agent/ads` is an explicit column allow-list, not `select("*")`.** A new column on `ads` does not become visible to the integration until it's added to `FIELDS`. That's what keeps close-out numbers, learnings and the `meta_*` roll-ups out of a key that has no reason to see them. `result` is on the list (the agent writes it and needs to read it back to stay idempotent); `spend` / `purchases` / `cvr` / `learning` deliberately are not.
- **The key can make exactly two writes, both narrow.** `POST /api/agent/ads/:id/meta-ad-id` writes one column. `POST /api/agent/ads/:id/result` writes `result`, `learning`, and — only with `close: true` — `stage`, where **the only stage value it can ever write is the terminal `"Winner / Killed"`** (a module constant, not a body parameter). So a compromised key can mislabel outcomes and close ads, but cannot pull work backwards through the pipeline, edit a brief, or delete. That's the security argument for handing the key out; don't widen it further without replacing it with per-scope keys.
- **Agent-set verdicts are stamped so they can be undone as a group.** `ads.result_source = 'agent'` + `result_set_at` (`agent_result_schema.sql`), probed for with the v4/v5 `select … limit 1` pattern so a missing migration costs attribution, not the write. Human close-outs leave both null — `persist()` writes a fixed column list from the browser and can't probe, so it deliberately doesn't set them.
- **The result endpoint does not enforce the `Testing → Winner / Killed` gate.** That gate stops a *person* clicking past the close-out form; the spend/purchases/CVR it demands are already on the row from the sync. Closing with no learning returns a `warnings` entry instead of a 400 — the Learnings view only lists closed ads that have one.
- **`result` values are normalized, not passed through.** `"Winner"` / `"Killed"` is the exact casing every screen matches on; Axel's word is "Looser". A synonym table maps `loser`/`looser`/`lost`/`win`/`w`/`l` etc. to the canonical pair and echoes `normalized` back, and anything unrecognized is a 400 — a near-miss spelling written straight through would sit in the column looking correct while the Learnings view, Reports and the pipeline badge all ignored it.
- It exists because `ads.meta_ad_id` is the **top-precedence** rule in `matchInsights()`. A launcher that posts back the id Meta returned turns attribution for that ad from name-parsing inference into fact.
- Meta ad ids exceed `Number.MAX_SAFE_INTEGER`, so the route **rejects a JSON number** rather than storing one that already lost precision in transit. Strings only.
- **The dashboard has no write access to Meta and gains none here.** `frame_io_link` is a link; we have never stored the creative file itself, so anything that uploads to Meta needs Frame.io credentials of its own.
- Key comparison hashes both sides before `timingSafeEqual` — raw strings of different lengths make it throw, and the throw leaks the real key's length. A key under 32 chars is treated as unset, so a placeholder can't become a live credential.

## Project status

Snapshot as of **2026-08-17**, re-verified against the tree that day (the measurements below keep their own dates). Update this when the situation changes; delete lines once they stop being true.

**The Analytics UI was rebuilt as a full Atria clone on 2026-08-13 and rejected — the work is reverted and the files are gone.** Read this before starting it again. The founder's ask was "copy Atria 100%, dark mode, everything except Ask Raya"; what shipped was Key Metrics with previous-period sparklines, Winners / High potential, Creative Diversity, Top Creative Tags with a metric selector, Breakdowns by age-gender / platform / country / placement, Top Spend and Top Performing, backed by a new `app/lib/metaInsights.ts` + `app/api/overview` reading Meta's Insights API with an ad-account switcher. It reproduced Atria's numbers on `act_2223260745102430` to within rounding. It was still turned down on look, in one line, with no specifics. **The lesson is not "Atria is unbuildable" — it's that this is a taste decision, so get a concrete visual direction agreed before spending a build on it.** What was learned along the way is kept in the data-availability note under Architecture; that part is still true and still useful.

**Meta Ads integration — built and verified against the live account.** Sync route, matcher, Analytics UI, manual override, persistence, revenue/ROAS. Verified end-to-end: stored totals reconcile with an independent recompute from Meta to within 0.014% on spend.

**Schema is applied.** All five SQL files (`meta_integration_schema.sql` → `_v2.sql` → `_v3.sql` → `_v4.sql` → `_v5.sql`) have been run against the live Supabase project — v1–v4 verified 2026-08-12, v5 verified 2026-08-13 (the breakdown panel renders populated). Re-run them only when standing up a fresh database.

**Data-quality audit, 2026-08-12** (run against the live account after the first successful sync — 77 of 80 ads carry spend):
- **`concept` is 100% untagged** — all $2.54M of spend sits under "— Unassigned". Its Top Creative Tags panel is therefore dead weight. `ad_type` is 6.9% untagged, `format` 2.9%; persona / core_emotion / problem / awareness are complete.
- **Nobody closes ads out: 0 of 80 have a `result`, 0 have a `learning`.** The Win rate column was removed from the Analytics table on 2026-08-12 because of this — it was dashes on every row. The Learnings view is empty for the same reason: by construction, not by bug. `settings_targets.target_hit_rate` still exists in the database but nothing reads it now.
- **Small-sample hazard in the tag panels.** The two best-looking ROAS buckets are the two smallest — "Gallbladder removal woman 40+" reads 1.12x on **2 ads**, against 0.53x on the 52-ad / $1.9M bucket. They're ranked and styled identically. Guarding this is the highest-value cheap fix on that page.
- **Triple Whale's `cogs` column is all zeros**, so margin can't come from there. Break-even ROAS needs a gross-margin figure entered in Settings; without it the 0.55x all-time / 0.90x 30-day ROAS can't be read as good or bad.

**Field-coverage audit, 2026-08-17** (all 99 ads, measured through `GET /api/agent/ads?stage=*`; the account has since grown to 109 ads, so re-measure before quoting these ratios). Run this before promising any integration a field — several that look central are empty in practice:
- **`selected_headline`, `selected_ad_copy` and `script_hook` are 0/99.** Not sparse — *never used*. The Copy Agent generates copy but nothing writes the chosen line back to the ad, so any consumer expecting copy from the dashboard gets null every time. Either wire the Copy Agent's selection into `persist()` or stop treating these as a source.
- **`meta_ad_id` is 0/99**, so the matcher's top-precedence rule has never actually fired — every match to date came from name parsing. That's the gap `POST /api/agent/ads/:id/meta-ad-id` exists to close.
- **`assigned_media_buyer` is 0/99.** Nothing that filters or routes by media buyer can work yet.
- **`frame_io_link` is 68/99, and only 12 of the 19 ads in Ready to Launch.** This is the sharp one for the agent API: 7 ads sit in the launch queue with no creative link at all, so a launcher polling that stage cannot get an asset for a third of what it finds. A data problem, not a code one — but any "auto-launch" flow needs to handle it rather than assume.
- `destination_url_primary` is 93/99 and 19/19 in Ready to Launch; `brief_link` 98/99. Those two are safe to depend on.

**Known data gaps — these are data problems, not bugs. Don't try to fix them in code:**
- Ad sets reference DTC numbers `ads` doesn't hold. On the 90-day window the largest are #82 (~$96k), #102 (~$42k), #14 (~$22k) and #128 (~$18k), roughly $375k unmatched in total. **Creating the missing brief in the dashboard fixes each one automatically** — the next sync attaches its spend, no override needed. #14 is a hole inside an otherwise continuous 1–80 range, so that brief was probably deleted rather than never created.
- Some spend sits under a `BATCH#27`-style naming scheme with no DTC number anywhere. Needs renaming in Ads Manager or a per-ad `meta_ad_id` override.
- `dtc_number` is **not unique** — #31 is duplicated ("Which NAC Wrecks Your Gut" / "AI Animated Hangover"), so one of the two can never receive data.

**Triple Whale — built, and now the default provider.** Verified live 2026-08-12 with the unmodified matcher: **76 of 80 ads and 81.6% of spend** on all-time, against 31 of 75 and ~52% on Meta direct. The migrations are all applied; the DB is ready.

**Attribution differs sharply between the two, which is the point.** Spend agrees (Triple Whale reports channel-reported spend). Revenue does not: over 90 days Triple Whale's pixel attributes $1,531,382 against $1,346,288 spend (**1.14x**) where Meta's own attribution reads **0.75x** on the same period — roughly 52% more revenue found. Ads killed on the Meta figure were judged on a number about a third too low. ROAS is still margin-blind either way.

**Settled 2026-08-13 — don't reopen without new evidence:** decimal DTCs (`#11.1`, `#12.2`) collapse into their integer parent, and that is **correct**. The ad sets name them `DTC #21.2 || Iteration || …` against `DTC #21 || Imitation || …`, so `.1`/`.2` are iterations of one brief, not separate briefs. The presentational half is handled by the by-variant panel in the breakdown.

**Open decisions:**
- **Should Analytics stay whole-store?** Triple Whale is connected at the *Shopify store* level, so every number on the page spans all six ad accounts — that is why nothing ever matched Atria, which reads one account. If the team only manages media buying in `act_2223260745102430`, an account filter would make the dashboard report on what they control. It would change nearly every figure on the page, so it's the founder's call, not a silent default.
- **Meta token access.** The token reaches 2 of the 6 accounts. Getting `ads_read` on `act_1123078669636137` ($1.83M) would unlock demographic and placement data for the majority of spend, and is a Business-settings request, not a code change.
- **Break-even ROAS is unknown, and it's the biggest open question on the page.** The account reads 0.55x all-time and 0.90x over 30 days, but ROAS is margin-blind and Triple Whale's `cogs` is empty, so nothing on screen says whether that's a disaster or fine. At 70% gross margin break-even is ~1.43x (almost everything loses money); at 90% it's ~1.11x. One gross-margin figure in Settings turns the whole page from reporting into a decision. Recommended next build.
- **Small-sample guarding on the tag panels.** See the audit above — a 2-ad bucket is currently ranked and styled identically to a 52-ad one. Cheap, pure UI, prevents a real bad call.
- **Does the dashboard ever launch ads itself?** Right now the answer is no, deliberately: Axel's OpenClaw reads the queue through the agent API and does the launching on his side. If that flips — if the ask becomes "the dashboard pushes to Meta" — four things are missing, and none are small. (1) `META_ACCESS_TOKEN` carries `ads_read` only; launching needs `ads_management`, a Business-settings request. (2) **The creative file isn't here** — `frame_io_link` is a link, so anything uploading to Meta needs Frame.io credentials of its own. (3) `Ad` has no campaign, ad set, budget, audience, bid, placement or schedule field; launching is a media-buying decision the schema has never modelled, so either a media buyer pre-creates the ad set or something invents targeting. (4) Six ad accounts, no default that's right. Treat "launch from the dashboard" as a new project, not an extension of the sync.
- **Nothing rate-limits the agent API.** A polling loop or a hijacked OpenClaw can hit `GET /api/agent/ads` as fast as it likes. Low stakes while the key reads a list and writes one id, but it's the first thing to add if the key's scope ever grows.

**Analytics overview — built.** Key Metrics with sparklines and previous-period deltas, Top Creative Tags across all seven strategy dimensions, Top Spend with creative thumbnails. Thumbnails come from Triple Whale's `ad_image_url` (1,253 of 1,255 rows carry one) and are its own CDN copy, so they don't expire with a token.

**Per-Meta-ad breakdown — built 2026-08-13.** The ad detail modal expands "Matched 70 Meta ads" into the rows behind it: a by-DTC-variant split first, then every Meta ad with its own spend / purchases / CPA / ROAS, spend-sorted, each linking to that ad in the account it actually lives in. Backed by `ads.meta_breakdown` (schema v5). Built because a single blended CPA over 70 creatives is correct and unreadable — it hides both the winner and the dead weight, and there was no way to audit where the spend came from. **This is also the answer to "is the match accurate?"** — it makes the roll-up checkable ad by ad instead of asking people to trust it.

**DTC #21 reconciled to the cent, 2026-08-13**, as an independent check of the matcher: 64 ads carrying a DTC token ($98,545.08) + 6 with no token that the matcher reached another way ($73) = 70 ads / $98,618, against the dashboard's 70 / $98,617.64. Renames are not inflating the count — the sync's `GROUP BY` produced 64 rows for 64 distinct `ad_id`s, and no ad carries two names. Its decimal split: #21 is 31 ads / $38.3k / CPA 91.82, #21.2 is 15 ads / $35.9k / CPA 87.42, #21.1 is 18 ads / $24.3k / CPA **150.14** — one iteration running at 1.6x the parent's CPA, which the summed row hid completely.

**Pipeline board filter — built.** Product / Persona / Editor / Ad Type / Format (the founder's ask), plus Priority, Timing (Overdue / Due this week / No due date) and an Unassigned toggle. `PipelineView.tsx` only.

**Self-produced ads — built 2026-08-14**, from Rob's ask (creative strategists making their own statics were forced to name an editor and paste a brief link for work they'd already finished). Scoped to the whole Strategist role, not one person. See the `isSelfProduced` note under Roles & permissions for how it's stored.

**Agent API — built 2026-08-17**, from Axel's ask (he wanted OpenClaw to launch the ads sitting in Ready to Launch automatically). He's building the Meta side himself, so this is only the read half: `GET /api/agent/ads` plus the one-column `meta-ad-id` write-back. Verified live against the dev server — 19 ads currently in Ready to Launch, and the missing-key / wrong-key / bad-uuid / numeric-id / unknown-ad paths all return the right status. The write path's happy case is the one thing not exercised end-to-end (it would have meant writing to the live DB). `AGENT_API_KEY` still has to be set in `.env.local` and Vercel — until it is, every agent request 401s by design.

**Winner / Killed ranking for the agent — built and verified 2026-08-19**, from Axel's follow-up ("I would need the authorization to have my OpenClaw ranking each folder as a Looser or Winner ad"). `POST /api/agent/ads/:id/result`. This is the first thing that will ever populate `ads.result` — **still 0 of 109 ads as of 2026-08-19** — so it also revives the Learnings view and makes the removed Win rate column buildable again *if* OpenClaw sends `learning` text with its verdicts. 55 of the 109 sit in Testing, which is the population it will rank.

Verified end-to-end against the live DB on DTC #1 (snapshot → three writes → exact restore, including `updated_at`): synonym normalization (`"Looser"` → `Killed`, `"win"` → `Winner`), `close: true` moving Testing → Winner / Killed, `previous_result` reporting, and clearing with `result: null`. Every error path returns the right status too. **`agent_result_schema.sql` has not been run yet** — that degraded branch is the one the verification actually exercised: writes succeed and come back `attribution_recorded: false` with a warning. Run the migration to turn attribution on.

**Open question on that build: should a bot be writing `learning` at all?** The Learnings view is the team's creative knowledge base, and 50 machine-written lines like "CPA above target" would turn it into noise. The field is optional on the endpoint, so this is Axel's call per request rather than a code decision — but if the team wants human-only learnings, the fix is to reject `learning` in the route and let `close: true` warn instead.

**`invite` and `delete-member` now verify the caller** (fixed 2026-08-17). Both require a session and `manage_team`; `delete-member` also refuses to delete the caller's own account, which would sign them out and could leave nobody able to manage the team. `useTeam.ts` sends the access token on both. Previously anyone who knew the URL could POST and mint themselves a Founder login.

## Styling

Inline `style={{}}` objects with CSS custom properties (`var(--card)`, `var(--text)`, `var(--border)`, etc.) defined in `app/globals.css` — **not** Tailwind utility classes in components, despite Tailwind v4 being installed. Icons come from `lucide-react`. Match this inline-style + CSS-variable convention when adding UI.

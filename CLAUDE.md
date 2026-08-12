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
npx tsc app/lib/metaMatch.ts --outDir /tmp/mm --module esnext --target es2020 \
  --moduleResolution bundler --skipLibCheck   # the @/app/types error is expected; it still emits
node --input-type=module -e 'import("/tmp/mm/metaMatch.js").then(m => console.log(m.extractDtcNumber("DTC 142 | 9x16")))'
```

## Environment

The app needs these env vars (Vercel: Project Settings > Environment Variables; locally: `.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-side Supabase client (`lib/supabaseClient.ts`).
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, used by `app/api/invite` and `app/api/delete-member` to call Supabase admin auth. Never expose to the client.
- `ANTHROPIC_API_KEY` — server-only, used by `app/api/generate-copy` (the Copy Agent).
- `TRIPLE_WHALE_API_KEY` — server-only. **Its presence is what selects the provider** (`activeProvider()` in `app/lib/tripleWhale.ts`): set it and syncs pull from Triple Whale, unset it and they fall back to Meta direct. Needs the `Pixel Attribution: Read` scope (plus `Summary Page: Read`); no write scope. Never expose to the client.
- `TRIPLE_WHALE_SHOP_ID` — optional, defaults to `rcv9b7-p1.myshopify.com`. Must be the `myshopify.com` domain, not the customer-facing one.
- `META_ACCESS_TOKEN` — server-only, used by `app/api/meta-sync` when no Triple Whale key is set. Long-lived (60-day) or System User token with `ads_read`. Never expose to the client.
- `META_AD_ACCOUNT_ID` — optional, defaults to `act_2223260745102430`.
- `META_API_VERSION` — optional, defaults to `v25.0`. Bump when Meta sunsets that version.

`lib/supabaseClient.ts` deliberately falls back to placeholder values and warns (rather than throwing) when the public vars are missing, so the Vercel prerender/build never crashes at module load.

## Architecture

Internal creative-ops dashboard for a DTC ad agency ("Revise"). It tracks ads through a production pipeline, gates stage transitions on required fields, enforces role-based permissions, and includes an AI copywriting tool. Backend is Supabase (Postgres + Auth); there is no custom server beyond a few Next.js route handlers.

**Single-page shell.** `app/page.tsx` is the whole app: a fixed sidebar plus one active view chosen from `NAV_ITEMS` via local `useState` (no router-based navigation between views). Each nav key maps to a component in `app/components/views/`. `app/layout.tsx` wraps everything in `AuthProvider`.

**Auth flow** (`app/hooks/useAuth.tsx`, a React context): `page.tsx` gates on it — `loading` → spinner, `needsPassword` → `SetPasswordPage`, no `session` → `LoginPage`, else the dashboard. Users are created by invite (`/api/invite`), not self-signup; invited/recovery users are detected via Supabase auth events or a `type=invite`/`type=recovery` URL hash and forced through password setup, which also flips their `team_members.status` to `active`.

**Roles & permissions are two separate systems — keep them distinct:**
- `app/lib/permissions.ts` — *who can do what*. `can(role, action)` checks a `RULES` table of `Action`s. Note the quirk: **Graphic Designer normalizes to Editor** (same permissions). This is the single source of truth for UI gating (create/edit/delete/review/manage). The logged-in user's role comes from `useMyRole()`, which looks it up in `team_members` by email. Current grants beyond Founder/Strategist: **Editor** has `create_ad`, `edit_title`, `edit_zone1`, `edit_zone2`, `move_stage`, `review_ad`; **Media Buyer** has `edit_zone2`, `move_stage`, `edit_performance`. Deletion (`delete_ad`, `batch_delete`) and `manage_lists` stay Founder + Strategist; `manage_team` is Founder-only. One asymmetry worth knowing: Editors can delete *ideas* (the Ideas view gates those buttons on `create_ad`) but not *ads*.
- `app/lib/gates.ts` — *what an ad needs before it advances*. `checkMove(ad, from, to)` returns `{ allowed, missing }`. Backward/same-stage moves are always free; forward moves must satisfy every `GATES` rule between the two stages. `STAGE_ORDER` (7 stages, Idea → Winner/Killed) is the canonical pipeline order.

**Data layer = per-entity hooks** in `app/hooks/` (`useAds`, `useIdeas`, `useLists`, `useTeam`, `useScript`, `useSettings`, `useTargets`, `useMetaSync`, `usePerfSeries`). Each owns its Supabase table: fetches on mount, exposes CRUD functions, and updates local state optimistically after each mutation. There is no global store or cache — views call these hooks directly. `useAds` also derives `nextDtcNumber()` and new ads always start at stage `"Idea"`. These hooks all trip `react-hooks/set-state-in-effect` with their fetch-on-mount effect; that's the established house pattern here, so match it rather than making one hook an outlier.

**Types** (`app/types/index.ts`) mirror the Supabase schema one-to-one (source: `phase1_schema.sql`, not in repo). The central entity is `Ad`, organized into zones: Strategy (Zone 1), Operational (Zone 2), and end-of-life Performance/Learning. Important: **`cpa` is never stored** — compute it with `calcCpa()` (`spend / purchases`). A `Learning` is just a closed `Ad` with a `learning` written; the Learnings view filters, there is no separate table. Editable dropdown values (stages, personas, roles, etc.) live in the `settings_lists` table keyed by `SettingsListType`, managed in the Settings view.

**Pipeline board filters** (`PipelineView.tsx`) — eight filters plus the free-text search, all local `useState`, `""` meaning "no filter". Three things worth preserving:
- **Dropdown options merge `settings_lists` with live ad values.** `buildOptions()` takes the canonical list order, then appends any value present on an ad but absent from the list. Without the second half, renaming or deleting a value in Settings would leave every ad still carrying it permanently unreachable by filtering.
- **Overdue is defined once, in three places.** `due_date < today && stage !== "Winner / Killed"` — the same expression `MyQueueView` and `WorkloadView` use. Change one, change all three or they'll disagree.
- **Stage headers read `3 of 12` whenever anything is narrowing** (any filter *or* a search query), so a near-empty column reads as a filter effect rather than an empty pipeline. The closed-ads modal applies the same filters, so its list can't contradict the count on the column that opened it.

**Two providers, one matcher.** `app/api/meta-sync/route.ts` fetches from either Meta direct (`fetchMetaRows()`, in the route) or Triple Whale (`app/lib/tripleWhale.ts`), both producing the same `MetaInsightRow[]`. Everything downstream — matcher, Analytics UI, `meta_*` columns, `effectivePerf()` — is provider-agnostic and was not touched to add Triple Whale. Things to know before editing `tripleWhale.ts`:
- **The SQL endpoint returns a bare JSON array**, not the `{ success, message, data }` envelope its own docs specify. Reading `.data` gives zero rows against a healthy `200` — a silent failure that looks like "no data found".
- The column is **`orders_quantity`**; the example query in Triple Whale's docs says `order_quantity`, which does not exist. `pixel_joined_tvf` takes no arguments despite the name, holds 185 columns, expands to ~98KB of inlined SQL (hence nonsense column positions in syntax errors), and runs on ClickHouse.
- Date params must be **camelCase** `@startDate` / `@endDate` over the API. The `@start_date` form works only in their in-app SQL Builder and fails here.
- `channel = 'facebook-ads'` is the Meta filter. Verified 2026-08-12: Meta $1.35M of 90-day spend vs $41.9k google-ads.
- The window ends **yesterday**, not today — the current day is still filling and would read as a drop on every sync.
- `pixel_joined_tvf` also carries **`ad_image_url`**, `creative_format`, `creative_cta_type` and asset counts. Not used yet; this is what the Atria-style Analytics rebuild needs.

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
- Schema lives in **four** files, run in order: `meta_integration_schema.sql` → `_v2.sql` → `_v3.sql` → `_v4.sql`. v2 adds `ads.meta_ad_ids` and `meta_sync_runs.unmatched`; v3 adds `ads.meta_revenue`; v4 adds `ads.meta_ad_image_url`. The route writes v1–v3 unconditionally, so syncing before running those fails every row update. **v4 is the exception** — the route probes for the column with a `select … limit 1` and omits it when absent, so a missing v4 costs you thumbnails rather than the whole sync. Copy that pattern for future columns.
- Known data gaps (not code bugs) are listed under Project status below; `dtc_number` is **not unique** — #31 is duplicated, and the matcher keeps only the first.

**API routes** (`app/api/*/route.ts`) exist only for operations that need a secret key server-side: `invite` and `delete-member` (Supabase service-role admin), `generate-copy` (Anthropic), `meta-sync` (Meta / Triple Whale), and `perf-series` (Triple Whale daily totals for the KPI sparklines — read-only, so it verifies the session but doesn't require `edit_performance`). `generate-copy` holds a large server-side "copy DNA" prompt library and calls the Messages API directly via `fetch`; it must return raw JSON parseable into `{ headlines, ad_copies }`.

## Project status

Snapshot as of **2026-08-12**. Update this when the situation changes; delete lines once they stop being true.

**Meta Ads integration — built and verified against the live account.** Sync route, matcher, Analytics UI, manual override, persistence, revenue/ROAS. Verified end-to-end: stored totals reconcile with an independent recompute from Meta to within 0.014% on spend.

**Schema is applied.** All four SQL files (`meta_integration_schema.sql` → `_v2.sql` → `_v3.sql` → `_v4.sql`) have been run against the live Supabase project — verified 2026-08-12. Re-run them only when standing up a fresh database.

**Data-quality audit, 2026-08-12** (run against the live account after the first successful sync — 77 of 80 ads carry spend):
- **`concept` is 100% untagged** — all $2.54M of spend sits under "— Unassigned". Its Top Creative Tags panel is therefore dead weight. `ad_type` is 6.9% untagged, `format` 2.9%; persona / core_emotion / problem / awareness are complete.
- **Nobody closes ads out: 0 of 80 have a `result`, 0 have a `learning`.** So the Win rate column is dashes on every row and the Learnings view is empty by construction, not by bug.
- **Small-sample hazard in the tag panels.** The two best-looking ROAS buckets are the two smallest — "Gallbladder removal woman 40+" reads 1.12x on **2 ads**, against 0.53x on the 52-ad / $1.9M bucket. They're ranked and styled identically. Guarding this is the highest-value cheap fix on that page.
- **Triple Whale's `cogs` column is all zeros**, so margin can't come from there. Break-even ROAS needs a gross-margin figure entered in Settings; without it the 0.55x all-time / 0.90x 30-day ROAS can't be read as good or bad.

**Known data gaps — these are data problems, not bugs. Don't try to fix them in code:**
- Ad sets reference DTC numbers `ads` doesn't hold. On the 90-day window the largest are #82 (~$96k), #102 (~$42k), #14 (~$22k) and #128 (~$18k), roughly $375k unmatched in total. **Creating the missing brief in the dashboard fixes each one automatically** — the next sync attaches its spend, no override needed. #14 is a hole inside an otherwise continuous 1–80 range, so that brief was probably deleted rather than never created.
- Some spend sits under a `BATCH#27`-style naming scheme with no DTC number anywhere. Needs renaming in Ads Manager or a per-ad `meta_ad_id` override.
- `dtc_number` is **not unique** — #31 is duplicated ("Which NAC Wrecks Your Gut" / "AI Animated Hangover"), so one of the two can never receive data.

**Triple Whale — built, and now the default provider.** Verified live 2026-08-12 with the unmodified matcher: **76 of 80 ads and 81.6% of spend** on all-time, against 31 of 75 and ~52% on Meta direct. The migrations are all applied; the DB is ready.

**Attribution differs sharply between the two, which is the point.** Spend agrees (Triple Whale reports channel-reported spend). Revenue does not: over 90 days Triple Whale's pixel attributes $1,531,382 against $1,346,288 spend (**1.14x**) where Meta's own attribution reads **0.75x** on the same period — roughly 52% more revenue found. Ads killed on the Meta figure were judged on a number about a third too low. ROAS is still margin-blind either way.

**Open decisions:**
- **Decimal DTCs** (`#11.1`, `#12.2`) currently collapse into their integer parent. Correct only if `.1` means "iteration of the same brief".
- **Break-even ROAS is unknown, and it's the biggest open question on the page.** The account reads 0.55x all-time and 0.90x over 30 days, but ROAS is margin-blind and Triple Whale's `cogs` is empty, so nothing on screen says whether that's a disaster or fine. At 70% gross margin break-even is ~1.43x (almost everything loses money); at 90% it's ~1.11x. One gross-margin figure in Settings turns the whole page from reporting into a decision. Recommended next build.
- **Small-sample guarding on the tag panels.** See the audit above — a 2-ad bucket is currently ranked and styled identically to a 52-ad one. Cheap, pure UI, prevents a real bad call.

**Analytics overview — built.** Key Metrics with sparklines and previous-period deltas, Top Creative Tags across all seven strategy dimensions, Top Spend with creative thumbnails. Thumbnails come from Triple Whale's `ad_image_url` (1,253 of 1,255 rows carry one) and are its own CDN copy, so they don't expire with a token.

**Pipeline board filter — built.** Product / Persona / Editor / Ad Type / Format (the founder's ask), plus Priority, Timing (Overdue / Due this week / No due date) and an Unassigned toggle. `PipelineView.tsx` only.

**Unaddressed security note:** `app/api/invite` and `app/api/delete-member` don't verify the caller. Anyone who knows the URL can POST and trigger a real Supabase invite (including `role: "Founder"`) or a member deletion. `meta-sync` shows the pattern to copy — verify the session, then check `can(role, action)`.

## Styling

Inline `style={{}}` objects with CSS custom properties (`var(--card)`, `var(--text)`, `var(--border)`, etc.) defined in `app/globals.css` — **not** Tailwind utility classes in components, despite Tailwind v4 being installed. Icons come from `lucide-react`. Match this inline-style + CSS-variable convention when adding UI.

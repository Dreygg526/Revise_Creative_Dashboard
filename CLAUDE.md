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
- `META_ACCESS_TOKEN` — server-only, used by `app/api/meta-sync`. Long-lived (60-day) or System User token with `ads_read`. Never expose to the client.
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

**Data layer = per-entity hooks** in `app/hooks/` (`useAds`, `useIdeas`, `useLists`, `useTeam`, `useScript`, `useSettings`, `useTargets`, `useMetaSync`). Each owns its Supabase table: fetches on mount, exposes CRUD functions, and updates local state optimistically after each mutation. There is no global store or cache — views call these hooks directly. `useAds` also derives `nextDtcNumber()` and new ads always start at stage `"Idea"`. These hooks all trip `react-hooks/set-state-in-effect` with their fetch-on-mount effect; that's the established house pattern here, so match it rather than making one hook an outlier.

**Types** (`app/types/index.ts`) mirror the Supabase schema one-to-one (source: `phase1_schema.sql`, not in repo). The central entity is `Ad`, organized into zones: Strategy (Zone 1), Operational (Zone 2), and end-of-life Performance/Learning. Important: **`cpa` is never stored** — compute it with `calcCpa()` (`spend / purchases`). A `Learning` is just a closed `Ad` with a `learning` written; the Learnings view filters, there is no separate table. Editable dropdown values (stages, personas, roles, etc.) live in the `settings_lists` table keyed by `SettingsListType`, managed in the Settings view.

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
- Schema lives in **three** files, run in order: `meta_integration_schema.sql` → `_v2.sql` → `_v3.sql`. v2 adds `ads.meta_ad_ids` and `meta_sync_runs.unmatched`; v3 adds `ads.meta_revenue`. The route writes all of them, so syncing before running them fails every row update.
- Known data gaps (not code bugs): Meta ad sets reference DTC numbers the dashboard doesn't have (#78–#128 while `ads` stops at #75), and `dtc_number` is **not unique** — #31 is duplicated, and the matcher keeps only the first.

**API routes** (`app/api/*/route.ts`) exist only for operations that need a secret key server-side: `invite` and `delete-member` (Supabase service-role admin), `generate-copy` (Anthropic), and `meta-sync` (Meta Marketing API). `generate-copy` holds a large server-side "copy DNA" prompt library and calls the Messages API directly via `fetch`; it must return raw JSON parseable into `{ headlines, ad_copies }`.

## Project status

Snapshot as of **2026-08-11**. Update this when the situation changes; delete lines once they stop being true.

**Meta Ads integration — built and verified against the live account.** Sync route, matcher, Analytics UI, manual override, persistence, revenue/ROAS. Verified end-to-end: stored totals reconcile with an independent recompute from Meta to within 0.014% on spend.

**Required before a sync will write:** run the three SQL files in order (`meta_integration_schema.sql` → `_v2.sql` → `_v3.sql`) in the Supabase SQL editor. Each adds columns the route writes to; skipping one makes every row update fail.

**Match rate on real data (90-day window, at time of writing):** 31 of 75 dashboard ads, ~52% of spend. The ceiling isn't the code — it's the two data gaps below.

**Known data gaps — these are data problems, not bugs. Don't try to fix them in code:**
- Meta ad sets reference DTC #78, #82, #89, #102, #116, #118, #128 with real spend behind them (~$196k over 90 days), but `ads` stops at #75. Those briefs were never logged, or the two numbering schemes have drifted apart.
- Roughly 7% of spend sits under a `BATCH#27`-style naming scheme with no DTC number anywhere. Needs renaming in Ads Manager or a per-ad `meta_ad_id` override.
- `dtc_number` is **not unique** — #31 is duplicated ("Which NAC Wrecks Your Gut" / "AI Animated Hangover"), so one of the two can never receive Meta data. #14 is missing, which is harmless.

**Open decisions:**
- **Triple Whale vs Meta direct** — still undecided. The fetch layer (`route.ts`) and the matching layer (`metaMatch.ts`) are deliberately separate: swapping providers means producing the same `MetaInsightRow[]` from a different source, leaving the matcher and the whole UI untouched.
- **Decimal DTCs** (`#11.1`, `#12.2`) currently collapse into their integer parent. Correct only if `.1` means "iteration of the same brief".
- **Account ROAS reads 0.75x** on Meta's own attribution ($448k spend / $338k revenue, 30 days). Reconcile against real store revenue before treating that as truth — Meta under-attribution and margin-blindness both apply.

**Not built yet:** the Pipeline board filter the founder asked for (filter by product / persona / editor / ad type). Unrelated to Meta; touches `PipelineView.tsx` only.

**Unaddressed security note:** `app/api/invite` and `app/api/delete-member` don't verify the caller. Anyone who knows the URL can POST and trigger a real Supabase invite (including `role: "Founder"`) or a member deletion. `meta-sync` shows the pattern to copy — verify the session, then check `can(role, action)`.

## Styling

Inline `style={{}}` objects with CSS custom properties (`var(--card)`, `var(--text)`, `var(--border)`, etc.) defined in `app/globals.css` — **not** Tailwind utility classes in components, despite Tailwind v4 being installed. Icons come from `lucide-react`. Match this inline-style + CSS-variable convention when adding UI.

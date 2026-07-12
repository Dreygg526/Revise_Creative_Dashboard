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

## Environment

The app needs these env vars (Vercel: Project Settings > Environment Variables; locally: `.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-side Supabase client (`lib/supabaseClient.ts`).
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, used by `app/api/invite` and `app/api/delete-member` to call Supabase admin auth. Never expose to the client.
- `ANTHROPIC_API_KEY` — server-only, used by `app/api/generate-copy` (the Copy Agent).

`lib/supabaseClient.ts` deliberately falls back to placeholder values and warns (rather than throwing) when the public vars are missing, so the Vercel prerender/build never crashes at module load.

## Architecture

Internal creative-ops dashboard for a DTC ad agency ("Revise"). It tracks ads through a production pipeline, gates stage transitions on required fields, enforces role-based permissions, and includes an AI copywriting tool. Backend is Supabase (Postgres + Auth); there is no custom server beyond a few Next.js route handlers.

**Single-page shell.** `app/page.tsx` is the whole app: a fixed sidebar plus one active view chosen from `NAV_ITEMS` via local `useState` (no router-based navigation between views). Each nav key maps to a component in `app/components/views/`. `app/layout.tsx` wraps everything in `AuthProvider`.

**Auth flow** (`app/hooks/useAuth.tsx`, a React context): `page.tsx` gates on it — `loading` → spinner, `needsPassword` → `SetPasswordPage`, no `session` → `LoginPage`, else the dashboard. Users are created by invite (`/api/invite`), not self-signup; invited/recovery users are detected via Supabase auth events or a `type=invite`/`type=recovery` URL hash and forced through password setup, which also flips their `team_members.status` to `active`.

**Roles & permissions are two separate systems — keep them distinct:**
- `app/lib/permissions.ts` — *who can do what*. `can(role, action)` checks a `RULES` table of `Action`s. Note the quirk: **Graphic Designer normalizes to Editor** (same permissions). This is the single source of truth for UI gating (create/edit/delete/review/manage). The logged-in user's role comes from `useMyRole()`, which looks it up in `team_members` by email.
- `app/lib/gates.ts` — *what an ad needs before it advances*. `checkMove(ad, from, to)` returns `{ allowed, missing }`. Backward/same-stage moves are always free; forward moves must satisfy every `GATES` rule between the two stages. `STAGE_ORDER` (7 stages, Idea → Winner/Killed) is the canonical pipeline order.

**Data layer = per-entity hooks** in `app/hooks/` (`useAds`, `useIdeas`, `useLists`, `useTeam`, `useScript`, `useSettings`, `useTargets`). Each owns its Supabase table: fetches on mount, exposes CRUD functions, and updates local state optimistically after each mutation. There is no global store or cache — views call these hooks directly. `useAds` also derives `nextDtcNumber()` and new ads always start at stage `"Idea"`.

**Types** (`app/types/index.ts`) mirror the Supabase schema one-to-one (source: `phase1_schema.sql`, not in repo). The central entity is `Ad`, organized into zones: Strategy (Zone 1), Operational (Zone 2), and end-of-life Performance/Learning. Important: **`cpa` is never stored** — compute it with `calcCpa()` (`spend / purchases`). A `Learning` is just a closed `Ad` with a `learning` written; the Learnings view filters, there is no separate table. Editable dropdown values (stages, personas, roles, etc.) live in the `settings_lists` table keyed by `SettingsListType`, managed in the Settings view.

**API routes** (`app/api/*/route.ts`) exist only for operations that need a secret key server-side: `invite` and `delete-member` (Supabase service-role admin), and `generate-copy` (Anthropic). `generate-copy` holds a large server-side "copy DNA" prompt library and calls the Messages API directly via `fetch`; it must return raw JSON parseable into `{ headlines, ad_copies }`.

## Styling

Inline `style={{}}` objects with CSS custom properties (`var(--card)`, `var(--text)`, `var(--border)`, etc.) defined in `app/globals.css` — **not** Tailwind utility classes in components, despite Tailwind v4 being installed. Icons come from `lucide-react`. Match this inline-style + CSS-variable convention when adding UI.

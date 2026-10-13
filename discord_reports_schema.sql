-- ============================================================
-- DISCORD REPORTS + MONTHLY KPI — approved by the boss 2026-10-13
-- (Downloads/Revise dashboard - Discord reports proposal v2.pdf).
--
-- 1. monthly_kpi          one row per month: the winner rule every report,
--                         alert, hit rate, monthly learnings report and Ask AI
--                         judges that month's data by. Settings → Monthly KPI.
-- 2. daily_figures_log    every daily-report run records the day figures it
--                         read, so we can measure how fast Triple Whale's data
--                         settles (the "1–2 days to load" question).
-- 3. discord_ask_log      one row per /ask in Discord: who, what, cost. Also
--                         what the per-person daily cap counts.
--
-- Needs is_team_member() from rls_lockdown.sql (already applied in prod).
-- Safe to run more than once. Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

-- ---- 1. Monthly KPI ---------------------------------------------------------
create table if not exists public.monthly_kpi (
  month          text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  goal           text check (goal in ('Profit', 'Scale')),
  nc_roas_target numeric not null check (nc_roas_target > 0 and nc_roas_target < 20),
  min_spend      numeric not null default 500  check (min_spend >= 0),
  potential_spend numeric not null default 1000 check (potential_spend > 0),
  potential_days integer not null default 5    check (potential_days between 1 and 30),
  watch_spend    numeric not null default 500  check (watch_spend > 0),
  set_by         text,
  updated_at     timestamptz not null default now()
);

-- Founder and Media Buyer set the KPI (decision #2 in the proposal).
create or replace function public.can_set_kpi()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members tm
    where lower(tm.email) = lower(auth.jwt() ->> 'email')
      and tm.role in ('Founder', 'Media Buyer')
  );
$$;
revoke all on function public.can_set_kpi() from public, anon;
grant execute on function public.can_set_kpi() to authenticated;

-- The store's month (Australia/Adelaide), which is the clock every report uses.
-- A month that has ended is locked, so changing November never rewrites
-- September's winners.
create or replace function public.kpi_month_open(m text)
returns boolean
language sql stable
as $$
  select m >= to_char(now() at time zone 'Australia/Adelaide', 'YYYY-MM');
$$;

alter table public.monthly_kpi enable row level security;
drop policy if exists monthly_kpi_read   on public.monthly_kpi;
drop policy if exists monthly_kpi_insert on public.monthly_kpi;
drop policy if exists monthly_kpi_update on public.monthly_kpi;
drop policy if exists monthly_kpi_delete on public.monthly_kpi;
create policy monthly_kpi_read   on public.monthly_kpi for select to authenticated using (public.is_team_member());
create policy monthly_kpi_insert on public.monthly_kpi for insert to authenticated
  with check (public.can_set_kpi() and public.kpi_month_open(month));
create policy monthly_kpi_update on public.monthly_kpi for update to authenticated
  using (public.can_set_kpi() and public.kpi_month_open(month))
  with check (public.can_set_kpi() and public.kpi_month_open(month));
create policy monthly_kpi_delete on public.monthly_kpi for delete to authenticated
  using (public.can_set_kpi() and public.kpi_month_open(month));
revoke all on public.monthly_kpi from anon;
grant select, insert, update, delete on public.monthly_kpi to authenticated;

-- Start October from the rule the team already uses (Learnings → Monthly
-- reports), so nothing changes on day one. Goal is left for the Founder.
insert into public.monthly_kpi (month, nc_roas_target, min_spend, set_by)
select '2026-10',
       coalesce((select value::numeric from public.settings_targets where key = 'learnings_nc_roas'  limit 1), 0.95),
       coalesce((select value::numeric from public.settings_targets where key = 'learnings_min_spend' limit 1), 500),
       'Carried over from the Learnings rule'
on conflict (month) do nothing;

-- ---- 2. Daily figures log ---------------------------------------------------
create table if not exists public.daily_figures_log (
  id           bigint generated always as identity primary key,
  run_at       timestamptz not null default now(),
  report_date  date not null,          -- the store day the report was sent on
  day          date not null,          -- the day these figures describe
  kind         text not null check (kind in ('early', 'final')),
  spend        numeric not null,
  revenue      numeric not null,
  nc_revenue   numeric not null,
  purchases    numeric not null,
  meta_revenue numeric not null
);
create index if not exists daily_figures_log_day on public.daily_figures_log (day, run_at);

alter table public.daily_figures_log enable row level security;
drop policy if exists daily_figures_log_read on public.daily_figures_log;
create policy daily_figures_log_read on public.daily_figures_log for select to authenticated using (public.is_team_member());
revoke all on public.daily_figures_log from anon;
grant select on public.daily_figures_log to authenticated;
-- Writes come only from the server (service role bypasses RLS).

-- ---- 3. /ask log ------------------------------------------------------------
create table if not exists public.discord_ask_log (
  id           bigint generated always as identity primary key,
  asked_at     timestamptz not null default now(),
  discord_user text not null,          -- Discord user id
  display_name text,
  channel_id   text,
  question     text not null,
  ok           boolean,
  cost_usd     numeric,
  tool_calls   integer
);
create index if not exists discord_ask_log_user on public.discord_ask_log (discord_user, asked_at);

alter table public.discord_ask_log enable row level security;
drop policy if exists discord_ask_log_read on public.discord_ask_log;
create policy discord_ask_log_read on public.discord_ask_log for select to authenticated using (public.is_founder());
revoke all on public.discord_ask_log from anon;
grant select on public.discord_ask_log to authenticated;

-- ---- Check ------------------------------------------------------------------
select c.relname as table_name, c.relrowsecurity as rls_on,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c
where c.relname in ('monthly_kpi', 'daily_figures_log', 'discord_ask_log');

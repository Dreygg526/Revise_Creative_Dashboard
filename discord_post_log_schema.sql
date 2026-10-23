-- ============================================================
-- discord_post_log (2026-10-23)
--
-- One row each time the weekly hit rate is posted to Discord, so the 7 PM PH
-- catch-up run (/api/cron/discord/catchup) can tell on a Monday whether it went
-- out. The daily report doesn't need this: daily_figures_log already plays
-- that role for it.
--
-- Needs is_team_member() from rls_lockdown.sql (already applied in prod).
-- Safe to run more than once. Supabase → SQL Editor → New query → paste → Run.
-- ============================================================

create table if not exists public.discord_post_log (
  id          bigint generated always as identity primary key,
  report      text not null check (report in ('hitrate')),
  report_date date not null,           -- the store day the report was sent for
  message_id  text,                    -- Discord's id for the posted message
  posted_at   timestamptz not null default now()
);
create index if not exists discord_post_log_report_date on public.discord_post_log (report, report_date);

alter table public.discord_post_log enable row level security;
drop policy if exists discord_post_log_read on public.discord_post_log;
create policy discord_post_log_read on public.discord_post_log for select to authenticated using (public.is_team_member());
revoke all on public.discord_post_log from anon;
grant select on public.discord_post_log to authenticated;
-- Writes come only from the server (service role bypasses RLS).

-- Check: should return one row, rls_on = true.
select relname, relrowsecurity as rls_on from pg_class where relname = 'discord_post_log';

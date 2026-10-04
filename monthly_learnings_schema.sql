-- ============================================================
-- Monthly learnings — one saved report per calendar month.
--
-- Written only by the server (service role, which bypasses RLS): the
-- /api/monthly-learnings route when someone clicks Generate, and the
-- /api/cron/monthly-learnings job on the 2nd of every month.
-- The browser only reads, so RLS is ON here from day one with a single
-- read policy for signed-in users — unlike the older tables, this one is
-- not reachable with the public anon key.
--
-- Independent of the meta_integration_schema chain. Safe to re-run.
-- ============================================================

create table if not exists monthly_learnings (
  month          text primary key,              -- 'YYYY-MM', the launch month
  generated_at   timestamptz not null default now(),
  generated_by   text,                          -- email, or 'cron'
  as_of          date not null,                 -- last day of performance data included
  min_spend      numeric not null,              -- the verdict thresholds in force for this run
  nc_roas_target numeric not null,
  data           jsonb not null,                -- briefs, verdicts, tag breakdown, totals
  summary        jsonb,                         -- Claude's write-up; null if that step failed
  summary_error  text
);

alter table monthly_learnings enable row level security;

drop policy if exists "members read monthly learnings" on monthly_learnings;
create policy "members read monthly learnings"
  on monthly_learnings for select
  to authenticated
  using (true);

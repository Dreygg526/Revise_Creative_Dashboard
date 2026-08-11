-- ============================================================
-- META ADS INTEGRATION — part 2
-- Run this AFTER meta_integration_schema.sql, in the Supabase SQL editor.
--
-- Adds what's needed to (a) deep-link a dashboard ad to its Meta ads
-- and (b) keep the last sync's result after a reload or restart.
-- ============================================================

-- The Meta ad IDs that rolled up into this dashboard ad. Lets the UI
-- link straight into Ads Manager for the exact creatives involved.
alter table ads
  add column if not exists meta_ad_ids text[];

-- The full unmatched list from the last run, so the "233 couldn't be
-- matched" panel survives a page reload instead of living only in
-- React state.
alter table meta_sync_runs
  add column if not exists unmatched jsonb;

-- The UI only ever wants the most recent run.
create index if not exists meta_sync_runs_created_at_idx
  on meta_sync_runs (created_at desc);

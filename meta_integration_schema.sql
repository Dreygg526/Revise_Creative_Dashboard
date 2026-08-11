-- ============================================================
-- META ADS INTEGRATION — schema additions
-- Run this in the Supabase SQL editor.
--
-- Design note: Meta numbers live in their OWN columns. The manual
-- spend / purchases / cvr fields written at close-out are never
-- touched by a sync, so a bad token or a mis-matched name can't
-- destroy hand-entered data. Analytics prefers meta_* when present
-- and falls back to the manual value.
--
-- CPA is NOT stored here, same as everywhere else in this app —
-- it stays computed (spend / purchases) via calcCpa().
-- ============================================================

alter table ads
  -- Manual override. Paste a Meta ad ID here to force the link when
  -- name matching can't figure an ad out. Takes priority over every
  -- other matching strategy.
  add column if not exists meta_ad_id text,

  -- Synced values from the Meta Marketing API.
  add column if not exists meta_spend numeric,
  add column if not exists meta_purchases numeric,
  add column if not exists meta_cvr numeric,
  add column if not exists meta_impressions bigint,
  add column if not exists meta_clicks bigint,

  -- Audit trail: which Meta ad name(s) fed this row, how many Meta
  -- ads rolled up into it, how they were matched, and when.
  add column if not exists meta_matched_name text,
  add column if not exists meta_matched_count integer,
  -- 'override' | 'dtc_number' (from ad name) | 'dtc_adset' | 'dtc_campaign' | 'ad_name'
  add column if not exists meta_match_method text,
  add column if not exists meta_synced_at timestamptz;

-- Fast lookup when the sync resolves overrides.
create index if not exists ads_meta_ad_id_idx on ads (meta_ad_id)
  where meta_ad_id is not null;

-- dtc_number is the primary join key for name matching.
create index if not exists ads_dtc_number_idx on ads (dtc_number)
  where dtc_number is not null;

-- ------------------------------------------------------------
-- Optional but recommended: a log of every sync run, so you can
-- answer "when did these numbers last change, and who ran it?"
-- ------------------------------------------------------------
create table if not exists meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  ran_by text,                      -- email of the user who clicked Sync
  ad_account_id text not null,
  date_preset text,
  rows_fetched integer not null default 0,
  ads_matched integer not null default 0,
  ads_updated integer not null default 0,
  unmatched_count integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

alter table meta_sync_runs enable row level security;

-- Readable by any signed-in user; only the service role writes to it.
drop policy if exists "meta_sync_runs_read" on meta_sync_runs;
create policy "meta_sync_runs_read" on meta_sync_runs
  for select to authenticated using (true);

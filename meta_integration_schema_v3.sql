-- ============================================================
-- META ADS INTEGRATION — part 3
-- Run AFTER meta_integration_schema.sql and _v2.sql.
--
-- Adds conversion VALUE so the dashboard can show revenue and ROAS,
-- not just spend and purchase counts. Spend alone can't tell you
-- whether an ad made money.
-- ============================================================

-- Purchase conversion value from Meta's action_values[] array.
-- ROAS is NOT stored — it's revenue / spend, computed like CPA.
alter table ads
  add column if not exists meta_revenue numeric;

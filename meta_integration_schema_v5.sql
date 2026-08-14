-- Meta/Triple Whale integration — schema v5
-- Run AFTER meta_integration_schema.sql, _v2.sql, _v3.sql and _v4.sql.
--
-- Adds the per-Meta-ad breakdown behind a matched brief.
--
-- Why: several Meta ads legitimately roll up into one dashboard ad (creative
-- variants, .1/.2 iterations, duplicated ad sets, relaunches). DTC #21 sums 70
-- of them. The roll-up is correct but unreadable — a single blended CPA across
-- 70 creatives hides both the winners and the dead weight, and there was no way
-- to audit where the spend came from. This column stores the rows that fed the
-- roll-up so the ad detail modal can show the split.
--
-- Shape: a JSON array, highest spend first, each entry
--   { ad_id, ad_name, adset_name, variant, spend, purchases, revenue,
--     impressions, clicks }
-- `variant` is the full DTC token including any decimal ("21", "21.1"), which
-- is what makes it visible whether iterations behave like separate briefs.
--
-- Capped at 200 rows per ad by the sync route — enough to audit, bounded enough
-- that a brief with a runaway ad set can't bloat the row.
--
-- Like v4, the sync route probes for this column before writing it, so syncing
-- without having run this file still works — you just get no breakdown.

ALTER TABLE ads ADD COLUMN IF NOT EXISTS meta_breakdown jsonb;

COMMENT ON COLUMN ads.meta_breakdown IS
  'Per-Meta-ad rows that summed into this brief''s meta_* totals, highest spend first. Set by /api/meta-sync; never entered by hand.';

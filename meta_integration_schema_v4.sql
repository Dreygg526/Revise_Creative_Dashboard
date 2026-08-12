-- Meta/Triple Whale integration — schema v4
-- Run AFTER meta_integration_schema.sql, _v2.sql and _v3.sql.
--
-- Adds the creative thumbnail so the Analytics overview can show what an ad
-- actually looked like instead of just its name. The URL is Triple Whale's
-- own CDN copy (files.triplewhale.com), not Meta's, so it doesn't expire with
-- an access token.
--
-- The sync route checks for this column before writing it, so syncing without
-- having run this file still works — you just get no thumbnails.

ALTER TABLE ads ADD COLUMN IF NOT EXISTS meta_ad_image_url text;

COMMENT ON COLUMN ads.meta_ad_image_url IS
  'Creative thumbnail URL for the highest-spend Meta ad matched to this brief. Set by /api/meta-sync; never entered by hand.';

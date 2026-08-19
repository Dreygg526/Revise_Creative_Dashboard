-- Agent API — result attribution columns
--
-- Independent of the meta_integration_schema chain; run it whenever.
--
-- Why: POST /api/agent/ads/{id}/result lets Axel's OpenClaw mark a brief
-- Winner or Killed. Once a machine can write `ads.result`, a row that reads
-- "Winner" no longer tells you whether a person judged it or a bot did — and
-- if the bot's ranking turns out to be wrong there is no way to find and undo
-- just its writes. These two columns keep that distinction.
--
--   result_source   'agent' when the agent API set it. NULL means nobody set
--                   it through the API — i.e. a person set it in the close-out
--                   modal, which does not write this column (persist() writes
--                   a fixed column list from the browser, where a column that
--                   doesn't exist yet would fail every save).
--   result_set_at   when that happened. `updated_at` moves on every edit;
--                   this one only moves when the verdict itself changes.
--
-- Both are cleared when the result is cleared (result: null).
--
-- Like meta v4/v5, the route probes for these before writing, so the endpoint
-- works without this file having been run — you just lose the attribution.

ALTER TABLE ads ADD COLUMN IF NOT EXISTS result_source text;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS result_set_at timestamptz;

COMMENT ON COLUMN ads.result_source IS
  'Who set ads.result: ''agent'' via /api/agent/ads/{id}/result, NULL if set by a person in the dashboard.';
COMMENT ON COLUMN ads.result_set_at IS
  'When ads.result was last set through the agent API. Unlike updated_at, unaffected by other edits.';

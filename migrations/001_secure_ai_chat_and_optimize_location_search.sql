-- Cloud SQL already contains the initial baseline, so this is the one
-- forward-only update required for authenticated-only AI chat and responsive
-- two-character location suggestions. Existing anonymous conversations are
-- retained for data-retention purposes but become inaccessible after the
-- guest credential columns are removed.

DROP INDEX IF EXISTS ai.uq_ai_conversations_guest_token_hash;
ALTER TABLE ai.conversations
  DROP COLUMN IF EXISTS guest_token_hash,
  DROP COLUMN IF EXISTS guest_token_expires_at;

ALTER TABLE ai.conversations
  ADD CONSTRAINT chk_ai_conversations_owner
  CHECK (user_id IS NOT NULL) NOT VALID;

ALTER TABLE ai.conversations
  DROP CONSTRAINT IF EXISTS conversations_user_id_fkey,
  ADD CONSTRAINT conversations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_geo_locations_name_prefix
  ON geo.locations (lower(name) text_pattern_ops) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_geo_location_aliases_prefix
  ON geo.location_aliases (lower(alias) text_pattern_ops);

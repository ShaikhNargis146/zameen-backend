ALTER TABLE auth.refresh_sessions
  ADD COLUMN IF NOT EXISTS family_id uuid;

UPDATE auth.refresh_sessions
SET family_id = gen_random_uuid()
WHERE family_id IS NULL;

ALTER TABLE auth.refresh_sessions
  ALTER COLUMN family_id SET NOT NULL,
  ALTER COLUMN family_id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_auth_refresh_sessions_family_active
  ON auth.refresh_sessions(family_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE ai.conversations
  ADD COLUMN IF NOT EXISTS guest_token_expires_at timestamptz;

UPDATE ai.conversations
SET guest_token_expires_at = created_at + interval '24 hours'
WHERE guest_token_hash IS NOT NULL AND guest_token_expires_at IS NULL;

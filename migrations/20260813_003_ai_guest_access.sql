ALTER TABLE ai.conversations
  ADD COLUMN IF NOT EXISTS guest_token_hash char(64);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_conversations_guest_token_hash
  ON ai.conversations (guest_token_hash)
  WHERE guest_token_hash IS NOT NULL;

-- Unified ledger for AI Property Assistant monthly-quota consumption across
-- all three surfaces that call the LLM (chat answers, POST /ai/search,
-- POST /ai/listing/generate). Previously only chat answers (counted via
-- ai.messages) were ever metered, so search/listing-generate calls were
-- completely unmetered and quota enforcement was a simple count-then-throw
-- with no protection against concurrent requests racing the same check. See
-- src/modules/ai/ai.repository.js (reserveAiQuotaUsage) and
-- src/modules/ai/ai.service.js (reserveAiQuota).
--
-- A row is reserved atomically (advisory-locked per user, so two concurrent
-- requests can't both slip in under a low quota) before the paid LLM call
-- starts; confirmed_at is set on success, after which the row counts for
-- the rest of the calendar month, or the row is deleted on failure so a
-- failed/aborted attempt never costs quota. An unconfirmed row only counts
-- provisionally for 5 minutes, so a crashed request can't permanently eat a
-- slot without needing a separate cleanup job.
CREATE TABLE IF NOT EXISTS ai.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind varchar(30) NOT NULL CHECK (kind IN ('CHAT','SEARCH','LISTING_GENERATE')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_month ON ai.usage_events(user_id, reserved_at);

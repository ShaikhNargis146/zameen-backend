-- Lets an organization's plan grant its members shared AI Property Assistant
-- quota, consumed from one pool at the organization level instead of each
-- member's own personal allowance. Scope is auto-detected per request, not
-- passed by the client: a caller who is an APPROVED channel partner
-- (account.channel_partner_profiles) attached to an organization that holds
-- an active plan draws exclusively from that organization's shared pool for
-- the month; everyone else (no such org link, or that org has no active
-- plan) keeps drawing from their own personal plan/free tier exactly as
-- before. The two scopes are never combined for the same request. See
-- src/modules/ai/ai.repository.js (activeOrganizationPlanForChannelPartner,
-- reserveAiQuotaUsage) and src/modules/ai/ai.service.js (reserveAiQuota).
ALTER TABLE ai.usage_events
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES account.organizations(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS ai.idx_ai_usage_events_user_month;
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_month
  ON ai.usage_events(user_id, reserved_at) WHERE organization_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_month
  ON ai.usage_events(organization_id, reserved_at) WHERE organization_id IS NOT NULL;

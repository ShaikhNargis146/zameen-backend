-- Closes the AI-quota rollout gap from migrations/016_subscription_entitlements.sql's
-- switch away from channel_partner_profiles-based org-quota pooling.
-- ai.service.js#reserveAiQuota now auto-detects org-pooling from
-- account.organization_members with no client involvement (see
-- commerce.repository.js#autoDetectPooledOrganizationForUser), replacing
-- the old mechanism that read account.channel_partner_profiles directly.
--
-- Every approved channel partner's only link to their org today is
-- channel_partner_profiles.organization_id -- account.organization_members
-- has never reflected it. Without this backfill, every one of them would
-- silently lose org-pooled AI quota the moment this ships, with no error and
-- no way for them to know why.
--
-- Decided: a real backfill into organization_members (role MEMBER), not a
-- narrower AI-quota-only shim, retiring channel_partner_profiles from
-- entitlement resolution entirely -- matching this plan's original intent.
-- This is a deliberate access-scope expansion beyond AI quota:
-- organization_members is also what every other membership-gated capability
-- in this codebase checks (managing the org's properties/listings,
-- appearing in its member list, org-scoped purchases, etc.), not just
-- AI-quota pooling. channel-partners.service.js#transition's approve action
-- now does this same INSERT going forward for every new approval (see
-- channel-partners.repository.js#ensureOrganizationMembership) -- this
-- migration is the one-time catch-up for approvals that already happened.
--
-- ON CONFLICT DO NOTHING: never overwrites an existing membership row of any
-- status -- an org admin's prior explicit REMOVED (or an existing
-- OWNER/ADMIN) for one of these users is left untouched, not silently
-- reactivated or downgraded.
--
-- Bypasses organizations.repository.js#addMember's team-member-seat limit on
-- purpose: these people already had effective access to their org via
-- channel_partner_profiles before this ran -- this reconciles that
-- pre-existing relationship into organization_members, it does not grant a
-- new seat. An org's current member count may read as "over" its plan's
-- teamMembers cap immediately after this runs; that cap only blocks *new*
-- invites going forward (via addMember), never this one-time backfill.
INSERT INTO account.organization_members (organization_id, user_id, role, status, joined_at)
SELECT cp.organization_id, cp.user_id, 'MEMBER', 'ACTIVE', now()
FROM account.channel_partner_profiles cp
WHERE cp.status = 'APPROVED' AND cp.organization_id IS NOT NULL
ON CONFLICT (organization_id, user_id) DO NOTHING;

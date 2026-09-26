-- Phase 1 of docs/subscription-entitlements-implementation-plan.md: closes
-- the entitlement-enforcement gap (listing/media/team-member limits, feature
-- gating, a plan-included featured-listing allowance) on top of the existing
-- commerce.plans/commerce.plan_subscriptions schema, rather than the
-- separate subscription_plans/user_subscriptions/subscription_usage schema
-- a since-superseded brief proposed. See that doc's §0 for why.

-- A free grant (see entitlements.service.js#grantFreePlan, called on
-- registration) has no purchase behind it, so order_item_id can no longer be
-- NOT NULL. It stays UNIQUE — Postgres treats multiple NULLs in a UNIQUE
-- column as distinct, so any number of free-grant rows can coexist without
-- colliding, while a real purchase's order_item_id is still enforced unique.
ALTER TABLE commerce.plan_subscriptions ALTER COLUMN order_item_id DROP NOT NULL;

-- Generic monthly usage ledger for any "N included per month" allowance
-- resolved from commerce.plans.features — today only featured listings
-- (features.featuredListingsPerMonth), but not hardcoded to that one
-- feature. Same owner shape as commerce.plan_subscriptions: user_id XOR
-- organization_id. See commerce.repository.js#consumeSubscriptionUsage for
-- the advisory-lock reserve/consume logic that writes here.
CREATE TABLE IF NOT EXISTS commerce.subscription_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES account.organizations(id) ON DELETE RESTRICT,
  feature varchar(50) NOT NULL,
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_subscription_usage_owner CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL)
);
-- Partial (not plain multi-column) unique indexes: a plain
-- UNIQUE(user_id, feature, period_start) would never actually collide across
-- org-owned rows, since every org row has user_id NULL and Postgres treats
-- NULLs as distinct for uniqueness -- these instead uniquely dedupe within
-- whichever owner form a row actually uses.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_subscription_usage_user
  ON commerce.subscription_usage(user_id, feature, period_start) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_subscription_usage_org
  ON commerce.subscription_usage(organization_id, feature, period_start) WHERE organization_id IS NOT NULL;

-- Seed data, not a lookup: no FREE/PRO/BUSINESS commerce.products/commerce.plans
-- rows exist anywhere in this codebase yet (confirmed against
-- scripts/seed-demo-data.js, which has no plan/product seeding at all).
-- Seeded here, idempotently, rather than in the demo seed script, because
-- the FREE plan must exist in every environment including production for
-- entitlements.service.js#grantFreePlan (called on every registration) to
-- have something to grant. The figures below are Phase 1 placeholders --
-- the entire point of keeping plan limits in commerce.plans.features/columns
-- rather than a constant is that admins can revise them via
-- PATCH /admin/plans/:planId without a deploy (see plan doc §10, brief §17).
INSERT INTO commerce.products (code, type, name, description, amount_minor, currency, is_active, gst_rate_bps, hsn_sac_code)
VALUES
  ('PLAN_FREE', 'PLAN', 'Free', 'Free tier for individual sellers getting started.', 0, 'INR', true, 1800, NULL),
  ('PLAN_PRO', 'PLAN', 'Pro', 'For active individual sellers who need more listings, media, and AI quota.', 99900, 'INR', true, 1800, NULL),
  ('PLAN_BUSINESS', 'PLAN', 'Business', 'For brokerages and developers managing a large portfolio and team.', 299900, 'INR', true, 1800, NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO commerce.plans (product_id, plan_type, duration_days, listing_limit, featured_days, verification_included, features, ai_monthly_quota)
SELECT p.id, 'FREE', NULL, 2, NULL, false,
  '{"imagesPerProperty":5,"videosPerProperty":0,"teamMembers":1,"advancedAnalytics":false,"verifiedBadge":false,"bulkUpload":false,"featuredListingsPerMonth":0}'::jsonb,
  5
FROM commerce.products p WHERE p.code = 'PLAN_FREE'
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO commerce.plans (product_id, plan_type, duration_days, listing_limit, featured_days, verification_included, features, ai_monthly_quota)
SELECT p.id, 'PREMIUM', 30, 20, 15, true,
  '{"imagesPerProperty":20,"videosPerProperty":2,"teamMembers":3,"advancedAnalytics":true,"verifiedBadge":true,"bulkUpload":false,"featuredListingsPerMonth":2}'::jsonb,
  100
FROM commerce.products p WHERE p.code = 'PLAN_PRO'
ON CONFLICT (product_id) DO NOTHING;

INSERT INTO commerce.plans (product_id, plan_type, duration_days, listing_limit, featured_days, verification_included, features, ai_monthly_quota)
SELECT p.id, 'BROKER', 30, NULL, 30, true,
  '{"imagesPerProperty":50,"videosPerProperty":5,"teamMembers":10,"advancedAnalytics":true,"verifiedBadge":true,"bulkUpload":true,"featuredListingsPerMonth":10}'::jsonb,
  NULL
FROM commerce.products p WHERE p.code = 'PLAN_BUSINESS'
ON CONFLICT (product_id) DO NOTHING;

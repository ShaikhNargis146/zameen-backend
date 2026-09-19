-- Adds the plan-entitlement and recurring-subscription schema needed for the
-- Razorpay redirect-based checkout, plus the uniqueness constraints that make
-- entitlement application idempotent. See docs/razorpay-integration-plan.md.

ALTER TABLE commerce.plans
  ADD COLUMN IF NOT EXISTS billing_mode varchar(20) NOT NULL DEFAULT 'ONE_TIME',
  ADD COLUMN IF NOT EXISTS provider_plan_id varchar(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plans_billing_mode_check' AND conrelid = 'commerce.plans'::regclass
  ) THEN
    ALTER TABLE commerce.plans
      ADD CONSTRAINT plans_billing_mode_check CHECK (billing_mode IN ('ONE_TIME','RECURRING'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_listing_promotions_order_item
  ON marketplace.listing_promotions(order_item_id) WHERE order_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_payment_provider_order_id
  ON commerce.payments(provider, provider_order_id) WHERE provider_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS commerce.plan_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES account.organizations(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES commerce.plans(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL UNIQUE REFERENCES commerce.order_items(id) ON DELETE RESTRICT,
  billing_mode varchar(20) NOT NULL CHECK (billing_mode IN ('ONE_TIME','RECURRING')),
  provider_subscription_id varchar(255),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status varchar(30) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING_AUTHORIZATION','ACTIVE','PAST_DUE','PAUSED','CANCELLED','EXPIRED','COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_plan_subscription_owner CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL),
  CONSTRAINT chk_plan_subscription_provider_id CHECK (billing_mode = 'ONE_TIME' OR provider_subscription_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_plan_subscriptions_provider
  ON commerce.plan_subscriptions(provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commerce_plan_subscriptions_user_active
  ON commerce.plan_subscriptions(user_id, ends_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_commerce_plan_subscriptions_org_active
  ON commerce.plan_subscriptions(organization_id, ends_at) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS commerce.promotion_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL UNIQUE REFERENCES commerce.products(id) ON DELETE RESTRICT,
  promotion_type varchar(30) NOT NULL CHECK (promotion_type IN ('PREMIUM','FEATURED','VERIFIED_BADGE','TOP_SEARCH')),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commerce.subscription_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_subscription_id uuid NOT NULL REFERENCES commerce.plan_subscriptions(id) ON DELETE RESTRICT,
  provider_payment_id varchar(255) NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0), currency char(3) NOT NULL DEFAULT 'INR',
  billing_cycle_number integer NOT NULL CHECK (billing_cycle_number > 0),
  charged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commerce_subscription_charges_payment
  ON commerce.subscription_charges(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_commerce_subscription_charges_subscription
  ON commerce.subscription_charges(plan_subscription_id, charged_at DESC);

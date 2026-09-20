-- Adds the plan-entitlement schema needed for the Razorpay redirect-based
-- checkout, plus the uniqueness constraints that make entitlement
-- application idempotent. See docs/razorpay-payment-flow-implementation.md.
--
-- Pre-freeze dev migration, rewritten in place (see migrations/README.md) to
-- drop the RECURRING-billing columns/table it originally pre-provisioned —
-- no purchase path ever used them, and carrying them forward as dead schema
-- only to have 006_remove_recurring_billing.sql immediately drop them again
-- serves no one. A database that already applied the original version of
-- this file keeps its ops.schema_migrations ledger entry (this runs by
-- filename, not content) and relies on 006 to clean those columns up instead.

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
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  status varchar(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_plan_subscription_owner CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL)
);
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

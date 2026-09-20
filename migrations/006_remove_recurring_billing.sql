-- Reverts the RECURRING billing scaffolding added in 004_commerce_entitlements.sql.
-- No POST /subscriptions purchase path was ever built (Phase 4 of
-- docs/razorpay-integration-plan.md remains unimplemented), so ONE_TIME is the
-- only billing mode any plan can actually use — this drops the now-dead
-- columns/table rather than carrying unreachable scaffolding.

DROP TABLE IF EXISTS commerce.subscription_charges;

ALTER TABLE commerce.plan_subscriptions
  DROP CONSTRAINT IF EXISTS chk_plan_subscription_provider_id;
DROP INDEX IF EXISTS commerce.uq_commerce_plan_subscriptions_provider;
ALTER TABLE commerce.plan_subscriptions
  DROP COLUMN IF EXISTS billing_mode,
  DROP COLUMN IF EXISTS provider_subscription_id;

ALTER TABLE commerce.plan_subscriptions
  DROP CONSTRAINT IF EXISTS plan_subscriptions_status_check;
ALTER TABLE commerce.plan_subscriptions
  ADD CONSTRAINT plan_subscriptions_status_check CHECK (status IN ('ACTIVE','CANCELLED','EXPIRED'));
UPDATE commerce.plan_subscriptions
  SET status = 'EXPIRED'
  WHERE status IN ('PENDING_AUTHORIZATION','PAST_DUE','PAUSED','COMPLETED');

ALTER TABLE commerce.plans
  DROP CONSTRAINT IF EXISTS plans_billing_mode_check;
ALTER TABLE commerce.plans
  DROP COLUMN IF EXISTS billing_mode,
  DROP COLUMN IF EXISTS provider_plan_id;

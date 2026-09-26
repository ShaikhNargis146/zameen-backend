-- Closes the "contact unlocks" gap identified against the pricing page:
-- POST /listings/:id/contact-reveal (enquiries.service.js#contactReveal) had
-- no plan-based limit at all -- any authenticated buyer, on any plan, could
-- reveal unlimited seller contacts. This migration adds the dedicated table
-- needed to track "has this buyer already unlocked this listing's contact"
-- (so a repeat view of an already-unlocked listing stays free, matching the
-- "5 lifetime" / "50" / "250" framing on the pricing page) and seeds the
-- corresponding plan limits.
--
-- Deliberately NOT reusing marketplace.listing_events (event_type =
-- 'CONTACT_REVEAL'): that table is an unconstrained analytics log -- every
-- click is recorded there today, duplicates and all -- and is read by the
-- seller-dashboard module for engagement stats. Overloading it with a
-- uniqueness constraint for quota purposes would change its analytics
-- semantics and risks colliding with pre-existing duplicate rows. This table
-- is purpose-built the same way marketplace.listing_promotions already is
-- the source of truth for "is this listing currently featured" rather than
-- reusing a generic event log for that check.
CREATE TABLE IF NOT EXISTS marketplace.contact_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES marketplace.listings(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_contact_unlocks_user ON marketplace.contact_unlocks(user_id);

-- Seed the plan limits the pricing page already advertises. FREE is a
-- lifetime cap (the plan itself never expires/resets, see grantFreePlan),
-- while PRO/BUSINESS are monthly, consistent with every other "N per month"
-- feature in commerce.plans.features (aiMonthlyQuota, featuredListingsPerMonth).
-- Merged with `||` so existing feature keys on these rows are preserved.
UPDATE commerce.plans pl SET features = COALESCE(pl.features, '{}'::jsonb) || '{"contactUnlocksLifetime":5}'::jsonb
FROM commerce.products pr WHERE pr.id = pl.product_id AND pr.code = 'PLAN_FREE';

UPDATE commerce.plans pl SET features = COALESCE(pl.features, '{}'::jsonb) || '{"contactUnlocksPerMonth":50}'::jsonb
FROM commerce.products pr WHERE pr.id = pl.product_id AND pr.code = 'PLAN_PRO';

UPDATE commerce.plans pl SET features = COALESCE(pl.features, '{}'::jsonb) || '{"contactUnlocksPerMonth":250}'::jsonb
FROM commerce.products pr WHERE pr.id = pl.product_id AND pr.code = 'PLAN_BUSINESS';

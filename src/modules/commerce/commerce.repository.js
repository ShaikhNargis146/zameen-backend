import { pg, run } from "../../shared/db.js";
import { resolveUsageCycle } from "../../shared/usageCycle.js";
import { splitGstMinor, stateCodeFromGstin } from "./tax.js";

const runTx = async fn => {
  const result = await pg.tx(fn);
  if (!result.ok) throw result.error;
  return result.data;
};

const planColumns = `
  pl.id, pr.id AS "productId", pr.code, pr.name, pl.plan_type AS "planType", pr.description,
  pr.amount_minor AS "amountMinor", pr.currency, pl.duration_days AS "durationDays",
  pl.listing_limit AS "listingLimit", pl.featured_days AS "featuredDays",
  pl.verification_included AS "verificationIncluded", pl.features, pr.is_active AS "isActive",
  pl.ai_monthly_quota AS "aiMonthlyQuota", pr.gst_rate_bps AS "gstRateBps", pr.hsn_sac_code AS "hsnSacCode",
  pl.created_at AS "createdAt", pl.updated_at AS "updatedAt"
`;

export const listActivePlans = planType =>
  run(
    "any",
    `SELECT ${planColumns} FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE pr.is_active = true AND pr.type = 'PLAN'
       AND ($1::varchar IS NULL OR pl.plan_type = $1)
     ORDER BY pr.amount_minor`,
    [planType]
  );

export const findPlanById = id =>
  run(
    "oneOrNone",
    `SELECT ${planColumns} FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE pl.id = $1`,
    [id]
  );

export const listPlansAdmin = ({ planType, isActive, search, limit, offset }) =>
  run(
    "any",
    `SELECT ${planColumns}, count(*) OVER()::int AS total FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE ($1::varchar IS NULL OR pl.plan_type = $1)
       AND ($2::boolean IS NULL OR pr.is_active = $2)
       AND ($3::varchar IS NULL OR pr.code ILIKE $3 OR pr.name ILIKE $3)
     ORDER BY pr.amount_minor
     LIMIT $4 OFFSET $5`,
    [planType, isActive, search ? `%${search}%` : null, limit, offset]
  );

export const findPlanByCode = code =>
  run(
    "oneOrNone",
    `SELECT pl.id FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE pr.code = $1`,
    [code]
  );

export const planHasOrders = planId =>
  run(
    "oneOrNone",
    `SELECT 1 FROM commerce.order_items oi
     JOIN commerce.plans pl ON pl.product_id = oi.product_id
     WHERE pl.id = $1 LIMIT 1`,
    [planId]
  ).then(Boolean);

// The buyer's own currently-active personal plan (organization-scoped plans
// are out of scope here -- see findActiveSubscriptionForOwner below for that
// path). No background sweep flips a lapsed row's status to EXPIRED, so this
// filters on ends_at lazily, at read time, rather than trusting status =
// 'ACTIVE' alone.
export const findActiveSubscriptionForUser = userId =>
  run(
    "oneOrNone",
    `SELECT ps.status AS "subscriptionStatus", ps.starts_at AS "startsAt", ps.ends_at AS "endsAt",
            ${planColumns}
     FROM commerce.plan_subscriptions ps
     JOIN commerce.plans pl ON pl.id = ps.plan_id
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE ps.user_id = $1 AND ps.organization_id IS NULL
       AND ps.status = 'ACTIVE' AND (ps.ends_at IS NULL OR ps.ends_at > now())
     ORDER BY ps.ends_at DESC NULLS LAST
     LIMIT 1`,
    [userId]
  );

// Same active-subscription lookup as findActiveSubscriptionForUser, but for
// whichever owner a resource actually belongs to: an org's plan when
// organizationId is set, otherwise the individual's own plan.
//
// This answers "does this owner currently hold a REAL plan_subscriptions
// row" — returns null if not, which matters where that distinction itself
// is the point (entitlements.service.js#grantFreePlan's own idempotency
// guard must see null for a brand-new owner, or it would never grant
// anything; capturePaymentAndApplyEntitlements's own inline expire-before-insert
// lookup has the same requirement). Entitlement CHECKS should call
// resolveEffectivePlanForOwner/ForUser below instead, not this directly.
export const findActiveSubscriptionForOwner = ({ userId, organizationId }) =>
  organizationId
    ? run(
        "oneOrNone",
        `SELECT ps.status AS "subscriptionStatus", ps.starts_at AS "startsAt", ps.ends_at AS "endsAt",
                ${planColumns}
         FROM commerce.plan_subscriptions ps
         JOIN commerce.plans pl ON pl.id = ps.plan_id
         JOIN commerce.products pr ON pr.id = pl.product_id
         WHERE ps.organization_id = $1
           AND ps.status = 'ACTIVE' AND (ps.ends_at IS NULL OR ps.ends_at > now())
         ORDER BY ps.ends_at DESC NULLS LAST
         LIMIT 1`,
        [organizationId]
      )
    : findActiveSubscriptionForUser(userId);

// The live, admin-editable PLAN_FREE catalog row, shaped like a real
// findActiveSubscriptionForOwner/ForUser result, for an owner with no
// currently-active plan_subscriptions row at all — whether they've never
// purchased anything, or purchased once and it has since lapsed with
// nothing newer. Returns null only if PLAN_FREE itself isn't seeded yet
// (the caller's own DEFAULT_FREE_* constant remains the last-resort safety
// net for that case).
const liveFreeTierPlan = async () => {
  const freePlan = await run(
    "oneOrNone",
    `SELECT ${planColumns} FROM commerce.plans pl
     JOIN commerce.products pr ON pr.id = pl.product_id
     WHERE pr.code = 'PLAN_FREE'`
  );
  return (
    freePlan && {
      subscriptionStatus: "ACTIVE",
      startsAt: null,
      endsAt: null,
      ...freePlan
    }
  );
};

// The plan that actually applies to this owner right now, for entitlement
// checks (limits, quota, features, GET /me/subscription) — as opposed to
// findActiveSubscriptionForOwner/ForUser above, which answer a narrower
// "does a real row exist" question. Falls back to the live PLAN_FREE
// catalog row instead of a hardcoded JS constant, identically for
// individual and organization owners, so an owner who purchased a paid plan
// once and let it lapse gets the SAME admin-editable Free tier as someone
// who never purchased anything — not a value frozen at deploy time. See
// docs/subscription-entitlements-audit-checklist.md §D1 for the bug this
// closes: before this, a lapsed paid plan silently fell back to
// DEFAULT_FREE_LISTING_LIMIT/etc. because the owner's original FREE grant
// had itself been marked EXPIRED the moment they bought something else.
export const resolveEffectivePlanForUser = async userId =>
  (await findActiveSubscriptionForUser(userId)) || liveFreeTierPlan();

export const resolveEffectivePlanForOwner = async ({
  userId,
  organizationId
}) =>
  (await findActiveSubscriptionForOwner({ userId, organizationId })) ||
  liveFreeTierPlan();

// Grants a plan with no purchase behind it (e.g. the ambient FREE plan on
// registration, see entitlements.service.js#grantFreePlan) — order_item_id
// is nullable for exactly this case (see migrations/016_subscription_entitlements.sql).
export const grantPlanDirectly = ({
  userId,
  organizationId,
  planId,
  startsAt,
  endsAt
}) =>
  run(
    "one",
    `INSERT INTO commerce.plan_subscriptions (user_id, organization_id, plan_id, starts_at, ends_at, status)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE') RETURNING id`,
    [userId, organizationId || null, planId, startsAt, endsAt]
  );

// Shared by consumeSubscriptionUsage and grantFeaturedListingFromAllowance
// below: checks the current period's usage against `limit` and
// increments/inserts it, inside an already-open transaction `t`. Factored
// out (rather than each caller opening its own runTx) so a caller that needs
// a second, related write in the same transaction — e.g. granting the
// promotion this usage unit unlocks — can do so atomically instead of as a
// separately-committed follow-up call, where a failure in that second write
// would otherwise leave the allowance permanently consumed with nothing
// actually granted. Mirrors ai.repository.reserveAiQuotaUsage's
// advisory-lock shape (lock the owner, count, then write). The lock key is
// namespaced by feature so this ledger and a future second feature never
// contend on the same advisory lock. Returns true if the unit was consumed,
// false if the period was already at limit.
// LIFETIME_PERIOD gives a feature that never resets (e.g. the FREE plan's
// contact-unlock cap -- see consumeContactUnlock below) a fixed period_start
// so it reuses this same ledger/lock/count machinery instead of a parallel
// code path, rather than a real calendar boundary.
const LIFETIME_PERIOD = {
  periodStart: new Date(0),
  periodEnd: new Date("9999-12-31T23:59:59.000Z")
};

// anchorStartsAt is the owner's CURRENT plan_subscriptions.starts_at (passed
// down from entitlements.service.js, which already resolved the active plan
// to read its limit) -- resolveUsageCycle anchors the MONTHLY period to it
// instead of the wall-clock calendar month, so a purchase/upgrade/renewal at
// any time immediately opens a fresh period with nothing carried over (see
// src/shared/usageCycle.js's header for why). `now` is accepted explicitly,
// mirroring computePlanEndsAt's own `now` parameter, purely for
// deterministic testing -- real callers never need to pass it.
const consumeUsageWithinTx = async (
  t,
  {
    userId,
    organizationId,
    feature,
    limit,
    periodMode = "MONTHLY",
    anchorStartsAt = null,
    now = new Date()
  }
) => {
  const lockKey = `${feature}:${organizationId || userId}`;
  await t.any(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [lockKey]);
  const period =
    periodMode === "LIFETIME"
      ? LIFETIME_PERIOD
      : resolveUsageCycle({ anchorStartsAt, now });
  const existing = await t.oneOrNone(
    organizationId
      ? `SELECT id, used_count AS "usedCount" FROM commerce.subscription_usage
         WHERE organization_id = $1 AND feature = $2 AND period_start = $3`
      : `SELECT id, used_count AS "usedCount" FROM commerce.subscription_usage
         WHERE user_id = $1 AND feature = $2 AND period_start = $3`,
    [organizationId || userId, feature, period.periodStart]
  );
  if (existing && existing.usedCount >= limit) return false;
  if (existing)
    await t.none(
      `UPDATE commerce.subscription_usage SET used_count = used_count + 1, updated_at = now() WHERE id = $1`,
      [existing.id]
    );
  else
    await t.none(
      `INSERT INTO commerce.subscription_usage (user_id, organization_id, feature, used_count, period_start, period_end)
       VALUES ($1,$2,$3,1,$4,$5)`,
      [
        organizationId ? null : userId,
        organizationId || null,
        feature,
        period.periodStart,
        period.periodEnd
      ]
    );
  return true;
};

// Generic monthly usage ledger backing any "N included per month" allowance
// resolved from commerce.plans.features. Standalone entry point for a
// feature whose entitlement *is* the counter itself, with no second write
// needed (unlike featured listings below).
export const consumeSubscriptionUsage = ({
  userId,
  organizationId,
  feature,
  limit,
  anchorStartsAt,
  now
}) =>
  runTx(t =>
    consumeUsageWithinTx(t, {
      userId,
      organizationId,
      feature,
      limit,
      anchorStartsAt,
      now
    })
  );

// Read-only, non-transactional twin of the already-featured check inside
// grantFeaturedListingFromAllowance's transaction below — used by
// entitlements.service.js#grantFeaturedListing when the owner's plan has no
// featuredListingsPerMonth allowance at all, so a request for an
// already-featured listing still gets an accurate alreadyFeatured: true
// instead of a misleading "no allowance left" (there's nothing to open a
// transaction for in that case, since there's no usage to consume).
export const isListingFeatured = listingId =>
  run(
    "oneOrNone",
    `SELECT id FROM marketplace.listing_promotions
     WHERE listing_id = $1 AND promotion_type = 'FEATURED' AND status = 'ACTIVE'
       AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`,
    [listingId]
  ).then(Boolean);

// Atomically consumes one unit of the owner's monthly featured-listing
// allowance and grants the FEATURED promotion in the same transaction as the
// usage write — see entitlements.service.js#grantFeaturedListing. Mirrors
// capturePaymentAndApplyEntitlements's existing precedent of writing
// marketplace.listing_promotions from this module.
//
// The already-featured check below guards against a double-tap/client retry
// of POST /listings/:id/feature: the advisory lock inside
// consumeUsageWithinTx is scoped to the owner's monthly total, not to this
// specific listing, so two back-to-back calls for the SAME listing would
// otherwise each independently pass the usage check and each grant their own
// promotion — consuming two allowance units for one listing. Checked first,
// before touching the usage ledger, so a double-tap costs nothing.
//
// Returns { promotion, alreadyFeatured: true } if the listing already has an
// active FEATURED promotion (no usage consumed); { promotion: null,
// alreadyFeatured: false } if the period's usage is already at the plan's
// limit; otherwise { promotion: { id, endsAt }, alreadyFeatured: false }.
export const grantFeaturedListingFromAllowance = ({
  userId,
  organizationId,
  limit,
  listingId,
  featuredDays,
  anchorStartsAt,
  now
}) =>
  runTx(async t => {
    const alreadyFeatured = await t.oneOrNone(
      `SELECT id FROM marketplace.listing_promotions
       WHERE listing_id = $1 AND promotion_type = 'FEATURED' AND status = 'ACTIVE'
         AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`,
      [listingId]
    );
    if (alreadyFeatured) return { promotion: null, alreadyFeatured: true };
    const consumed = await consumeUsageWithinTx(t, {
      userId,
      organizationId,
      feature: "FEATURED_LISTINGS",
      limit,
      anchorStartsAt,
      now
    });
    if (!consumed) return { promotion: null, alreadyFeatured: false };
    const promotion = await t.one(
      `INSERT INTO marketplace.listing_promotions (listing_id, promotion_type, starts_at, ends_at, status)
       VALUES ($1,'FEATURED', now(), now() + ($2 || ' days')::interval, 'ACTIVE')
       RETURNING id, ends_at AS "endsAt"`,
      [listingId, featuredDays]
    );
    return { promotion, alreadyFeatured: false };
  });

// Atomically resolves "has this buyer already unlocked this listing's
// contact" and, if not, consumes one unit of their plan's contact-unlock
// allowance and records the unlock -- see
// entitlements.service.js#consumeContactUnlock. Combined into one
// transaction (already-unlocked check, usage consume, and the unlock record
// insert) for the same reason grantFeaturedListingFromAllowance above does:
// two independently-committed writes could let a double-tap consume two
// allowance units for one listing, or let two concurrent first-time reveals
// of the same listing both pass the already-unlocked check before either
// commits.
//
// periodMode is "LIFETIME" for the FREE plan's 5-lifetime cap and "MONTHLY"
// for paid plans' renewal-period allowance (see consumeUsageWithinTx's
// LIFETIME_PERIOD above) -- resolved by the caller from the plan type.
//
// Returns { unlocked: true, alreadyUnlocked: true } (no usage consumed) if
// this buyer already unlocked this exact listing before; { unlocked: true,
// alreadyUnlocked: false } if this is a genuinely new unlock and the plan
// has room for it (or has no limit configured at all -- limit null/undefined
// means unlimited, same convention as every other resolveXLimit in this
// codebase); { unlocked: false, alreadyUnlocked: false } once the period's
// allowance is exhausted.
export const consumeContactUnlock = ({
  userId,
  listingId,
  limit,
  periodMode,
  anchorStartsAt,
  now
}) =>
  runTx(async t => {
    const lockKey = `CONTACT_UNLOCKS:${userId}`;
    await t.any(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [lockKey]);
    const already = await t.oneOrNone(
      `SELECT id FROM marketplace.contact_unlocks WHERE listing_id = $1 AND user_id = $2`,
      [listingId, userId]
    );
    if (already) return { unlocked: true, alreadyUnlocked: true };
    if (limit !== null && limit !== undefined) {
      const consumed = await consumeUsageWithinTx(t, {
        userId,
        organizationId: null,
        feature: "CONTACT_UNLOCKS",
        limit,
        periodMode,
        anchorStartsAt,
        now
      });
      if (!consumed) return { unlocked: false, alreadyUnlocked: false };
    }
    await t.none(
      `INSERT INTO marketplace.contact_unlocks (listing_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [listingId, userId]
    );
    return { unlocked: true, alreadyUnlocked: false };
  });

// Read-only current-period usage count for display (e.g. GET /me/subscription)
// — never used for enforcement, which always goes through
// consumeUsageWithinTx's locked read-then-write above. periodMode mirrors
// consumeContactUnlock's -- "LIFETIME" reads the same fixed period_start
// LIFETIME_PERIOD.periodStart writes to, "MONTHLY" (default) reads whichever
// renewal-anchored cycle resolveUsageCycle resolves `anchorStartsAt`/`now`
// to, same as every other metered feature (see consumeUsageWithinTx above).
export const countSubscriptionUsageThisPeriod = ({
  userId,
  organizationId,
  feature,
  periodMode = "MONTHLY",
  anchorStartsAt,
  now
}) => {
  const periodStart =
    periodMode === "LIFETIME"
      ? LIFETIME_PERIOD.periodStart
      : resolveUsageCycle({ anchorStartsAt, now }).periodStart;
  return run(
    "oneOrNone",
    organizationId
      ? `SELECT used_count AS "usedCount" FROM commerce.subscription_usage
         WHERE organization_id = $1 AND feature = $2 AND period_start = $3`
      : `SELECT used_count AS "usedCount" FROM commerce.subscription_usage
         WHERE user_id = $1 AND feature = $2 AND period_start = $3`,
    [organizationId || userId, feature, periodStart]
  ).then(row => row?.usedCount || 0);
};

export const createPlan = ({
  code,
  name,
  description,
  amountMinor,
  currency,
  isActive,
  planType,
  durationDays,
  listingLimit,
  featuredDays,
  verificationIncluded,
  features,
  aiMonthlyQuota,
  gstRateBps,
  hsnSacCode
}) =>
  runTx(async t => {
    const product = await t.one(
      `INSERT INTO commerce.products (code, type, name, description, amount_minor, currency, is_active, gst_rate_bps, hsn_sac_code)
       VALUES ($1,'PLAN',$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        code,
        name,
        description,
        amountMinor,
        currency,
        isActive,
        gstRateBps ?? 1800,
        hsnSacCode ?? null
      ]
    );
    const plan = await t.one(
      `INSERT INTO commerce.plans (product_id, plan_type, duration_days, listing_limit, featured_days, verification_included, features, ai_monthly_quota)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
      [
        product.id,
        planType,
        durationDays,
        listingLimit,
        featuredDays,
        verificationIncluded,
        JSON.stringify(features || {}),
        aiMonthlyQuota ?? null
      ]
    );
    return plan.id;
  });

const productColumnMap = {
  code: "code",
  name: "name",
  description: "description",
  amountMinor: "amount_minor",
  currency: "currency",
  isActive: "is_active",
  gstRateBps: "gst_rate_bps",
  hsnSacCode: "hsn_sac_code"
};
const planColumnMap = {
  planType: "plan_type",
  durationDays: "duration_days",
  listingLimit: "listing_limit",
  featuredDays: "featured_days",
  verificationIncluded: "verification_included",
  features: "features",
  aiMonthlyQuota: "ai_monthly_quota"
};

export const updatePlan = ({ productId, planId, changes }) =>
  runTx(async t => {
    const productChanges = {};
    const planChanges = {};
    for (const [field, column] of Object.entries(productColumnMap))
      if (Object.hasOwn(changes, field))
        productChanges[column] = changes[field];
    for (const [field, column] of Object.entries(planColumnMap))
      if (Object.hasOwn(changes, field)) planChanges[column] = changes[field];

    if (Object.keys(productChanges).length) {
      const columns = Object.keys(productChanges);
      const setSql = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");
      await t.none(`UPDATE commerce.products SET ${setSql} WHERE id = $1`, [
        productId,
        ...columns.map(col => productChanges[col])
      ]);
    }
    if (Object.keys(planChanges).length) {
      const columns = Object.keys(planChanges);
      const setSql = columns
        .map((col, i) =>
          col === "features"
            ? `${col} = $${i + 2}::jsonb`
            : `${col} = $${i + 2}`
        )
        .join(", ");
      await t.none(`UPDATE commerce.plans SET ${setSql} WHERE id = $1`, [
        planId,
        ...columns.map(col =>
          col === "features"
            ? JSON.stringify(planChanges[col])
            : planChanges[col]
        )
      ]);
    }
    return true;
  });

export const setPlanActive = (planId, isActive) =>
  run(
    "oneOrNone",
    `UPDATE commerce.products p SET is_active = $2
     FROM commerce.plans pl
     WHERE pl.product_id = p.id AND pl.id = $1
     RETURNING pl.id`,
    [planId, isActive]
  );

export const findProductsByIds = ids =>
  run(
    "any",
    `SELECT p.id, p.code, p.name, p.type, p.amount_minor AS "amountMinor", p.currency, p.is_active AS "isActive",
            p.gst_rate_bps AS "gstRateBps", p.hsn_sac_code AS "hsnSacCode",
            pl.id AS "planId",
            promo.promotion_type AS "promotionType", promo.duration_days AS "promotionDurationDays"
     FROM commerce.products p
     LEFT JOIN commerce.plans pl ON pl.product_id = p.id
     LEFT JOIN commerce.promotion_catalog promo ON promo.product_id = p.id
     WHERE p.id = ANY($1::uuid[])`,
    [ids]
  );

// Ownership check for a PROMOTION order item's targetId (Section 7 of
// docs/razorpay-integration-plan.md) — the listing must belong to the buyer
// or their purchasing organization.
export const findOwnedListingForPromotion = (
  listingId,
  { actorId, organizationId }
) =>
  run(
    "oneOrNone",
    `SELECT id FROM marketplace.listings
     WHERE id = $1 AND deleted_at IS NULL
       AND (seller_user_id = $2 OR ($3::uuid IS NOT NULL AND seller_organization_id = $3))`,
    [listingId, actorId, organizationId || null]
  );

// Ownership + payability check for a SERVICE order item's targetId. The
// service request must belong to the buyer and not already be paid for.
export const findPayableServiceRequest = (serviceRequestId, actorId) =>
  run(
    "oneOrNone",
    `SELECT id FROM commerce.service_requests
     WHERE id = $1 AND user_id = $2 AND status = 'REQUESTED' AND order_id IS NULL`,
    [serviceRequestId, actorId]
  );

const orderColumns = `
  o.id, o.order_number AS "orderNumber", o.user_id AS "userId", o.organization_id AS "organizationId",
  o.status, o.subtotal_minor AS "subtotalMinor", o.tax_minor AS "taxMinor", o.total_minor AS "totalMinor",
  o.currency, o.created_at AS "createdAt",
  (SELECT p.paid_at FROM commerce.payments p WHERE p.order_id = o.id AND p.status = 'CAPTURED'
   ORDER BY p.paid_at DESC LIMIT 1) AS "paidAt",
  -- o.status alone cannot distinguish "waiting on the current payment
  -- attempt" from "the last attempt failed, retry needed" — both leave the
  -- order in PAYMENT_PENDING so a same-order retry stays allowed (see
  -- createPaymentIntent). Surfacing the most recent payment's own status
  -- lets the result page tell the two apart instead of polling forever.
  (SELECT p.status FROM commerce.payments p WHERE p.order_id = o.id
   ORDER BY p.created_at DESC LIMIT 1) AS "latestPaymentStatus"
`;

export const createOrder = ({
  orderNumber,
  userId,
  organizationId,
  subtotalMinor,
  taxMinor,
  totalMinor,
  currency,
  items
}) =>
  runTx(async t => {
    const order = await t.one(
      `INSERT INTO commerce.orders (order_number, user_id, organization_id, status, subtotal_minor, tax_minor, total_minor, currency)
       VALUES ($1,$2,$3,'CREATED',$4,$5,$6,$7) RETURNING id`,
      [
        orderNumber,
        userId,
        organizationId,
        subtotalMinor,
        taxMinor,
        totalMinor,
        currency
      ]
    );
    for (const item of items) {
      await t.none(
        `INSERT INTO commerce.order_items
           (order_id, product_id, quantity, unit_amount_minor, total_amount_minor, gst_rate_bps, hsn_sac_code, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [
          order.id,
          item.productId,
          item.quantity,
          item.unitAmountMinor,
          item.totalAmountMinor,
          item.gstRateBps || 0,
          item.hsnSacCode || null,
          JSON.stringify({
            targetType: item.targetType || null,
            targetId: item.targetId || null
          })
        ]
      );
      // Re-claim the service request inside the transaction, not just at the
      // pre-check in commerce.service.js — closes the race where two
      // concurrent orders are created for the same unpaid service request.
      if (item.targetType === "SERVICE_REQUEST") {
        const claimed = await t.oneOrNone(
          `UPDATE commerce.service_requests
           SET status = 'PAYMENT_PENDING', order_id = $2
           WHERE id = $1 AND user_id = $3 AND status = 'REQUESTED' AND order_id IS NULL
           RETURNING id`,
          [item.targetId, order.id, userId]
        );
        if (!claimed) {
          const error = new Error("Service request is no longer payable.");
          error.code = "SERVICE_REQUEST_NOT_PAYABLE";
          throw error;
        }
      }
    }
    return order.id;
  });

export const findById = id =>
  run(
    "oneOrNone",
    `SELECT ${orderColumns} FROM commerce.orders o WHERE o.id = $1`,
    [id]
  );

export const findOwnedByUser = (id, userId) =>
  run(
    "oneOrNone",
    `SELECT ${orderColumns} FROM commerce.orders o WHERE o.id = $1 AND o.user_id = $2`,
    [id, userId]
  );

// userId null (admin) sees any order; otherwise scoped to the owning buyer —
// same nullable-param ownership pattern used throughout this file (e.g.
// listPaymentsAdmin). Joined with the buyer and, when applicable, the
// purchasing organization, since an invoice needs a "bill to" name/GSTIN
// that the plain orderColumns view above doesn't carry.
export const findOrderInvoiceRow = (id, userId) =>
  run(
    "oneOrNone",
    `SELECT o.id, o.order_number AS "orderNumber", o.user_id AS "userId", o.organization_id AS "organizationId",
            o.status, o.subtotal_minor AS "subtotalMinor", o.total_minor AS "totalMinor", o.currency,
            o.invoice_number AS "invoiceNumber", o.buyer_gstin AS "buyerGstin",
            o.place_of_supply_state_code AS "placeOfSupplyStateCode",
            o.cgst_minor AS "cgstMinor", o.sgst_minor AS "sgstMinor", o.igst_minor AS "igstMinor",
            (SELECT p.paid_at FROM commerce.payments p WHERE p.order_id = o.id AND p.status = 'CAPTURED'
             ORDER BY p.paid_at DESC LIMIT 1) AS "paidAt",
            u.display_name AS "buyerName", u.phone_e164 AS "buyerPhone", u.email::text AS "buyerEmail",
            org.name AS "organizationName"
     FROM commerce.orders o
     JOIN auth.users u ON u.id = o.user_id
     LEFT JOIN account.organizations org ON org.id = o.organization_id
     WHERE o.id = $1 AND ($2::uuid IS NULL OR o.user_id = $2)`,
    [id, userId]
  );

export const listForUser = (userId, { status }, { limit, offset }) =>
  run(
    "any",
    `SELECT ${orderColumns}, count(*) OVER()::int AS total
     FROM commerce.orders o
     WHERE o.user_id = $1 AND ($2::varchar IS NULL OR o.status = $2)
     ORDER BY o.created_at DESC LIMIT $3 OFFSET $4`,
    [userId, status, limit, offset]
  );

export const itemsForOrders = orderIds =>
  run(
    "any",
    `SELECT oi.order_id AS "orderId", oi.product_id AS "productId", pr.code, pr.name, oi.quantity,
            oi.unit_amount_minor AS "unitAmountMinor", oi.total_amount_minor AS "totalAmountMinor",
            oi.gst_rate_bps AS "gstRateBps", oi.hsn_sac_code AS "hsnSacCode", oi.metadata
     FROM commerce.order_items oi
     JOIN commerce.products pr ON pr.id = oi.product_id
     WHERE oi.order_id = ANY($1::uuid[])
     ORDER BY oi.created_at`,
    [orderIds]
  );

export const setOrderStatus = (id, status) =>
  run("none", `UPDATE commerce.orders SET status = $2 WHERE id = $1`, [
    id,
    status
  ]);

const paymentSelectColumns = `
  pay.id, pay.order_id AS "orderId", pay.provider, pay.provider_order_id AS "providerOrderId",
  pay.provider_payment_id AS "providerPaymentId", pay.status, pay.amount_minor AS "amountMinor",
  pay.currency, pay.paid_at AS "paidAt", pay.created_at AS "createdAt"
`;
const paymentInsertColumns = paymentSelectColumns.replace(/pay\./g, "");

// `id` is generated by the caller (not left to the column default) so it can
// be embedded in the Razorpay Payment Link's notes before this row exists —
// see commerce.service.js createPaymentIntent.
export const createPayment = ({
  id,
  orderId,
  provider,
  providerOrderId,
  amountMinor,
  currency
}) =>
  run(
    "one",
    `INSERT INTO commerce.payments (id, order_id, provider, provider_order_id, status, amount_minor, currency)
     VALUES ($1,$2,$3,$4,'CREATED',$5,$6)
     RETURNING ${paymentInsertColumns}`,
    [id, orderId, provider, providerOrderId, amountMinor, currency]
  );

export const findPaymentById = id =>
  run(
    "oneOrNone",
    `SELECT ${paymentSelectColumns} FROM commerce.payments pay WHERE pay.id = $1`,
    [id]
  );

export const findPaymentByProviderOrderId = (provider, providerOrderId) =>
  run(
    "oneOrNone",
    `SELECT ${paymentSelectColumns} FROM commerce.payments pay
     WHERE pay.provider = $1 AND pay.provider_order_id = $2`,
    [provider, providerOrderId]
  );

// Joined with the owning order and buyer so admin list/detail views never
// need a second round trip to answer "whose payment is this, for what order".
const paymentAdminJoinColumns = `
  o.order_number AS "orderNumber", o.status AS "orderStatus", o.user_id AS "userId",
  o.organization_id AS "organizationId", o.subtotal_minor AS "orderSubtotalMinor",
  o.tax_minor AS "orderTaxMinor", o.total_minor AS "orderTotalMinor", o.invoice_number AS "invoiceNumber",
  u.display_name AS "buyerName", u.phone_e164 AS "buyerPhone", u.email::text AS "buyerEmail"
`;

export const listPaymentsAdmin = (
  { status, provider, orderId, userId, search, fromDate, toDate },
  { limit, offset }
) =>
  run(
    "any",
    `SELECT ${paymentSelectColumns}, ${paymentAdminJoinColumns}, count(*) OVER()::int AS total
     FROM commerce.payments pay
     JOIN commerce.orders o ON o.id = pay.order_id
     JOIN auth.users u ON u.id = o.user_id
     WHERE ($1::varchar IS NULL OR pay.status = $1)
       AND ($2::varchar IS NULL OR pay.provider = $2)
       AND ($3::uuid IS NULL OR pay.order_id = $3)
       AND ($4::uuid IS NULL OR o.user_id = $4)
       AND ($5::varchar IS NULL OR o.order_number ILIKE $5 OR u.display_name ILIKE $5
            OR u.phone_e164 ILIKE $5 OR u.email::text ILIKE $5
            OR pay.provider_order_id ILIKE $5 OR pay.provider_payment_id ILIKE $5)
       AND ($6::date IS NULL OR pay.created_at >= $6)
       AND ($7::date IS NULL OR pay.created_at < ($7::date + INTERVAL '1 day'))
     ORDER BY pay.created_at DESC LIMIT $8 OFFSET $9`,
    [
      status || null,
      provider || null,
      orderId || null,
      userId || null,
      search ? `%${search}%` : null,
      fromDate || null,
      toDate || null,
      limit,
      offset
    ]
  );

export const findPaymentByIdAdmin = id =>
  run(
    "oneOrNone",
    `SELECT ${paymentSelectColumns}, pay.updated_at AS "updatedAt",
            pay.provider_payload AS "providerPayload", ${paymentAdminJoinColumns}
     FROM commerce.payments pay
     JOIN commerce.orders o ON o.id = pay.order_id
     JOIN auth.users u ON u.id = o.user_id
     WHERE pay.id = $1`,
    [id]
  );

// Explicitly fails any non-terminal payment attempt still open for this order
// before a fresh Payment Link is created for a retried /payments/:orderId/create
// call, per Section 8 of docs/razorpay-integration-plan.md. Returns the
// provider order ids that were just failed so the caller can also cancel
// them on Razorpay's side — this row flip alone does not stop the old
// Payment Link from still being payable there.
export const failActivePaymentsForOrder = orderId =>
  run(
    "any",
    `UPDATE commerce.payments SET status = 'FAILED'
     WHERE order_id = $1 AND status IN ('CREATED','AUTHORIZED')
     RETURNING id, provider_order_id AS "providerOrderId"`,
    [orderId]
  );

export const failPayment = ({ id, providerPayload }) =>
  pg.updateWhere({
    table: "commerce.payments",
    set: { status: "FAILED", provider_payload: providerPayload },
    where: "id = ${id}",
    params: { id },
    returning: paymentInsertColumns,
    jsonbCols: ["provider_payload"]
  });

// Extends an existing plan_subscriptions.ends_at, or starts a fresh window
// from `now` if there is no still-active existing entitlement to extend.
// Exported for unit testing independent of the database.
export const computePlanEndsAt = ({ existingEndsAt, durationDays, now }) => {
  if (durationDays == null) return null;
  const existingMs = existingEndsAt ? new Date(existingEndsAt).getTime() : 0;
  const base = existingMs > now.getTime() ? existingMs : now.getTime();
  return new Date(base + durationDays * 24 * 60 * 60 * 1000);
};

// Captures the payment, marks the order paid, and applies whatever product
// entitlement each order item grants — all in one transaction, so a payment
// is never left CAPTURED without its entitlement effect (or vice versa).
// Shared by both the Payment Link callback handler and the webhook handler
// (Sections 10-11 of docs/razorpay-integration-plan.md) so the two paths
// cannot disagree; each entitlement write is independently idempotent so
// calling this twice for the same payment is harmless.
export const capturePaymentAndApplyEntitlements = ({
  id,
  orderId,
  providerPaymentId,
  providerPayload,
  sellerGstin
}) =>
  runTx(async t => {
    const payment = await t.one(
      `UPDATE commerce.payments
       SET status = 'CAPTURED', paid_at = now(), provider_payment_id = $2, provider_payload = $3::jsonb
       WHERE id = $1
       RETURNING ${paymentInsertColumns}`,
      [id, providerPaymentId, JSON.stringify(providerPayload || {})]
    );
    const order = await t.one(
      `UPDATE commerce.orders SET status = 'PAID' WHERE id = $1
       RETURNING user_id AS "userId", organization_id AS "organizationId"`,
      [orderId]
    );
    const items = await t.any(
      `SELECT oi.id AS "orderItemId", oi.metadata, oi.total_amount_minor AS "totalAmountMinor",
              oi.gst_rate_bps AS "gstRateBps", p.type,
              pl.id AS "planId", pl.duration_days AS "durationDays",
              promo.promotion_type AS "promotionType", promo.duration_days AS "promotionDurationDays"
       FROM commerce.order_items oi
       JOIN commerce.products p ON p.id = oi.product_id
       LEFT JOIN commerce.plans pl ON pl.product_id = p.id
       LEFT JOIN commerce.promotion_catalog promo ON promo.product_id = p.id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    const now = new Date();
    for (const item of items) {
      if (item.type === "PLAN") {
        const already = await t.oneOrNone(
          `SELECT id FROM commerce.plan_subscriptions WHERE order_item_id = $1`,
          [item.orderItemId]
        );
        if (already) continue;
        // Scoped to exactly this purchase's owner — a personal purchase
        // (organizationId null) must never match or expire an organization's
        // plan, and vice versa, even when the same person is on both sides.
        const existing = await t.oneOrNone(
          `SELECT id, ends_at AS "endsAt" FROM commerce.plan_subscriptions
           WHERE status = 'ACTIVE'
             AND (
               ($2::uuid IS NULL AND user_id = $1 AND organization_id IS NULL)
               OR ($2::uuid IS NOT NULL AND organization_id = $2)
             )
           ORDER BY ends_at DESC NULLS LAST LIMIT 1`,
          [order.userId, order.organizationId]
        );
        if (existing)
          await t.none(
            `UPDATE commerce.plan_subscriptions SET status = 'EXPIRED' WHERE id = $1`,
            [existing.id]
          );
        const endsAt = computePlanEndsAt({
          existingEndsAt: existing?.endsAt,
          durationDays: item.durationDays,
          now
        });
        await t.none(
          `INSERT INTO commerce.plan_subscriptions
             (user_id, organization_id, plan_id, order_item_id, starts_at, ends_at, status)
           VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE')
           ON CONFLICT (order_item_id) DO NOTHING`,
          [
            order.userId,
            order.organizationId,
            item.planId,
            item.orderItemId,
            now,
            endsAt
          ]
        );
      } else if (item.type === "PROMOTION") {
        const endsAt = new Date(
          now.getTime() + item.promotionDurationDays * 24 * 60 * 60 * 1000
        );
        await t.none(
          `INSERT INTO marketplace.listing_promotions
             (listing_id, promotion_type, order_item_id, starts_at, ends_at, status)
           VALUES ($1,$2,$3,$4,$5,'ACTIVE')
           ON CONFLICT (order_item_id) WHERE order_item_id IS NOT NULL DO NOTHING`,
          [
            item.metadata?.targetId,
            item.promotionType,
            item.orderItemId,
            now,
            endsAt
          ]
        );
      } else if (item.type === "SERVICE") {
        await t.none(
          `UPDATE commerce.service_requests SET status = 'IN_PROGRESS'
           WHERE id = $1 AND order_id = $2 AND status = 'PAYMENT_PENDING'`,
          [item.metadata?.targetId, orderId]
        );
      }
    }

    // Invoice number + GST split are assigned once, here, at the moment the
    // order actually becomes PAID — never recomputed later, so redownloading
    // an invoice always shows the same number/split even if a product's
    // gst_rate_bps changes afterwards (order_items already snapshots the
    // rate used below). Place of supply defaults to the seller's own state
    // (intra-state) since no buyer billing address exists anywhere in this
    // schema; an org-billed order can override that via its own gst_number.
    const org = order.organizationId
      ? await t.oneOrNone(
          `SELECT gst_number AS "gstNumber" FROM account.organizations WHERE id = $1`,
          [order.organizationId]
        )
      : null;
    const buyerGstin = org?.gstNumber || null;
    const sellerStateCode = stateCodeFromGstin(sellerGstin);
    const placeOfSupplyStateCode =
      stateCodeFromGstin(buyerGstin) || sellerStateCode;
    const isIntraState = placeOfSupplyStateCode === sellerStateCode;

    const totals = items.reduce(
      (acc, item) => {
        const split = splitGstMinor({
          totalAmountMinor: item.totalAmountMinor,
          gstRateBps: item.gstRateBps,
          isIntraState
        });
        acc.cgstMinor += split.cgstMinor;
        acc.sgstMinor += split.sgstMinor;
        acc.igstMinor += split.igstMinor;
        return acc;
      },
      { cgstMinor: 0, sgstMinor: 0, igstMinor: 0 }
    );

    const { n: invoiceSeq } = await t.one(
      `SELECT nextval('commerce.invoice_number_seq') AS n`
    );
    const invoiceNumber = `INV-${String(invoiceSeq).padStart(6, "0")}`;
    await t.none(
      `UPDATE commerce.orders
       SET invoice_number = $2, buyer_gstin = $3, place_of_supply_state_code = $4,
           cgst_minor = $5, sgst_minor = $6, igst_minor = $7
       WHERE id = $1`,
      [
        orderId,
        invoiceNumber,
        buyerGstin,
        placeOfSupplyStateCode,
        totals.cgstMinor,
        totals.sgstMinor,
        totals.igstMinor
      ]
    );

    // userId/organizationId are returned alongside the payment so the
    // caller can notify the buyer without a second round trip — payments
    // rows carry no user reference of their own, only orders do.
    return {
      ...payment,
      userId: order.userId,
      organizationId: order.organizationId,
      invoiceNumber
    };
  });

// The ON CONFLICT DO UPDATE only fires (and thus RETURNING only yields a row)
// for a genuinely new event or a previously failed one ready for retry.
// markWebhookProcessed always sets processed_at, on both success and
// failure, so a failed event is only distinguishable by processing_error
// being non-null; the DO UPDATE claims the retry by clearing processed_at
// and processing_error in the same statement, so a duplicate delivery that
// arrives while this retry is in-flight sees processing_error already NULL
// and fails the WHERE clause instead of racing it to run capture/fail side
// effects twice. Postgres holds the row lock for the conflicting key while
// evaluating this, so concurrent deliveries for the same event serialize on it.
export const insertWebhookEvent = ({
  provider,
  eventId,
  eventType,
  payload,
  paymentId
}) =>
  run(
    "oneOrNone",
    `INSERT INTO commerce.payment_webhook_events (provider, event_id, event_type, payload, payment_id)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (provider, event_id) DO UPDATE
       SET event_type = EXCLUDED.event_type,
           payment_id = EXCLUDED.payment_id,
           processed_at = NULL,
           processing_error = NULL
       WHERE commerce.payment_webhook_events.processing_error IS NOT NULL
     RETURNING id, processed_at AS "processedAt", processing_error AS "processingError"`,
    [
      provider,
      eventId,
      eventType,
      JSON.stringify(payload || {}),
      paymentId || null
    ]
  );

export const markWebhookProcessed = (id, error = null) =>
  run(
    "none",
    `UPDATE commerce.payment_webhook_events SET processed_at = now(), processing_error = $2 WHERE id = $1`,
    [id, error]
  );

// The webhook trace for a single payment — what Razorpay actually sent, in
// delivery order — for the admin payment detail view (GET
// /admin/payments/:paymentId). Requires the payment_id backfill from
// 007_payment_webhook_event_payment_link.sql; deliveries received before
// that migration ran have no linkage and will not appear here.
export const findWebhookEventsByPaymentId = paymentId =>
  run(
    "any",
    `SELECT id, provider, event_id AS "eventId", event_type AS "eventType", payload,
            received_at AS "receivedAt", processed_at AS "processedAt", processing_error AS "processingError"
     FROM commerce.payment_webhook_events
     WHERE payment_id = $1
     ORDER BY received_at DESC`,
    [paymentId]
  );

const serviceColumns = `
  sc.id, pr.id AS "productId", pr.code, sc.service_type AS "serviceType", pr.name, pr.description,
  pr.amount_minor AS "amountMinor", sc.requires_property AS "requiresProperty",
  sc.requires_documents AS "requiresDocuments", pr.is_active AS "isActive"
`;

export const listActiveServices = serviceType =>
  run(
    "any",
    `SELECT ${serviceColumns} FROM commerce.service_catalog sc
     JOIN commerce.products pr ON pr.id = sc.product_id
     WHERE pr.is_active = true AND pr.type = 'SERVICE'
       AND ($1::varchar IS NULL OR sc.service_type = $1)
     ORDER BY pr.name`,
    [serviceType]
  );

export const findServiceById = id =>
  run(
    "oneOrNone",
    `SELECT ${serviceColumns} FROM commerce.service_catalog sc
     JOIN commerce.products pr ON pr.id = sc.product_id
     WHERE sc.id = $1`,
    [id]
  );

export const servicesByIds = ids =>
  run(
    "any",
    `SELECT ${serviceColumns} FROM commerce.service_catalog sc
     JOIN commerce.products pr ON pr.id = sc.product_id
     WHERE sc.id = ANY($1::uuid[])`,
    [ids]
  );

const serviceRequestColumns = `
  sr.id, sr.service_id AS "serviceId", sr.user_id AS "userId", sr.property_id AS "propertyId",
  sr.listing_id AS "listingId", sr.order_id AS "orderId", sr.status,
  sr.assigned_to_user_id AS "assignedToUserId", sr.customer_notes AS "customerNotes",
  sr.internal_notes AS "internalNotes", sr.contact_phone AS "contactPhone", sr.contact_email AS "contactEmail",
  sr.completed_report_storage_key AS "completedReportStorageKey", sr.report_summary AS "reportSummary",
  sr.created_at AS "createdAt", sr.updated_at AS "updatedAt", sr.completed_at AS "completedAt"
`;
const serviceRequestInsertColumns = serviceRequestColumns.replace(/sr\./g, "");

export const createServiceRequest = ({
  serviceId,
  userId,
  propertyId,
  listingId,
  customerNotes,
  contactPhone,
  contactEmail
}) =>
  pg.one(
    `INSERT INTO commerce.service_requests (service_id, user_id, property_id, listing_id, customer_notes, contact_phone, contact_email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING ${serviceRequestInsertColumns}`,
    [
      serviceId,
      userId,
      propertyId,
      listingId,
      customerNotes,
      contactPhone,
      contactEmail
    ]
  );

export const findServiceRequestById = id =>
  run(
    "oneOrNone",
    `SELECT ${serviceRequestColumns} FROM commerce.service_requests sr WHERE sr.id = $1`,
    [id]
  );

export const findServiceRequestOwnedByUser = (id, userId) =>
  run(
    "oneOrNone",
    `SELECT ${serviceRequestColumns} FROM commerce.service_requests sr WHERE sr.id = $1 AND sr.user_id = $2`,
    [id, userId]
  );

export const listServiceRequestsForUser = (
  userId,
  { status },
  { limit, offset }
) =>
  run(
    "any",
    `SELECT ${serviceRequestColumns}, count(*) OVER()::int AS total
     FROM commerce.service_requests sr
     WHERE sr.user_id = $1 AND ($2::varchar IS NULL OR sr.status = $2)
     ORDER BY sr.created_at DESC LIMIT $3 OFFSET $4`,
    [userId, status, limit, offset]
  );

export const listServiceRequestsAdmin = (
  { status, serviceType, search },
  { limit, offset }
) =>
  run(
    "any",
    `SELECT ${serviceRequestColumns}, count(*) OVER()::int AS total
     FROM commerce.service_requests sr
     JOIN commerce.service_catalog sc ON sc.id = sr.service_id
     JOIN auth.users u ON u.id = sr.user_id
     LEFT JOIN land.properties p ON p.id = sr.property_id
     WHERE ($1::varchar IS NULL OR sr.status = $1)
       AND ($2::varchar IS NULL OR sc.service_type = $2)
       AND ($3::varchar IS NULL OR u.display_name ILIKE $3 OR u.phone_e164 ILIKE $3
            OR u.email::text ILIKE $3 OR p.public_code ILIKE $3)
     ORDER BY sr.created_at DESC LIMIT $4 OFFSET $5`,
    [status, serviceType, search ? `%${search}%` : null, limit, offset]
  );

export const setServiceRequestStatus = ({ id, status, internalNote }) => {
  const set = { status };
  if (internalNote !== undefined) set.internal_notes = internalNote;
  if (status === "COMPLETED") set.completed_at = new Date();
  return pg.updateWhere({
    table: "commerce.service_requests",
    set,
    where: "id = ${id}",
    params: { id },
    returning: serviceRequestInsertColumns
  });
};

export const setServiceRequestReport = ({ id, storageKey, summary }) =>
  pg.updateWhere({
    table: "commerce.service_requests",
    set: {
      status: "COMPLETED",
      completed_report_storage_key: storageKey,
      report_summary: summary,
      completed_at: new Date()
    },
    where: "id = ${id}",
    params: { id },
    returning: serviceRequestInsertColumns
  });

const serviceRequestFileColumns = `
  f.id, f.storage_key AS "storageKey", f.file_name AS "fileName", f.mime_type AS "mimeType",
  f.file_size_bytes AS "fileSizeBytes", f.uploaded_by_user_id AS "uploadedByUserId", f.created_at AS "createdAt"
`;

export const insertServiceRequestFile = ({
  serviceRequestId,
  storageKey,
  fileName,
  mimeType,
  fileSizeBytes,
  uploadedByUserId
}) =>
  run(
    "one",
    `INSERT INTO commerce.service_request_files (service_request_id, storage_key, file_name, mime_type, file_size_bytes, uploaded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING ${serviceRequestFileColumns.replace(/f\./g, "")}`,
    [
      serviceRequestId,
      storageKey,
      fileName,
      mimeType,
      fileSizeBytes,
      uploadedByUserId
    ]
  );

export const filesForServiceRequests = serviceRequestIds =>
  run(
    "any",
    `SELECT f.service_request_id AS "serviceRequestId", ${serviceRequestFileColumns} FROM commerce.service_request_files f
     WHERE f.service_request_id = ANY($1::uuid[]) ORDER BY f.created_at`,
    [serviceRequestIds]
  );

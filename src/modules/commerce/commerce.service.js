import { randomUUID } from "crypto";
import { isNonProductionEnv } from "../../config/env.js";
import { HttpError } from "../../shared/http.js";
import {
  parsePagination,
  paginationMeta,
  splitCountedRows
} from "../../shared/pagination.js";
import { sha256 } from "../../utils/crypto.js";
import logger from "../../utils/logger.js";
import {
  belongsToServiceReport,
  belongsToServiceRequest,
  createServiceReportStorageKey,
  createServiceRequestStorageKey,
  signedReadUrl,
  signedWriteUrl
} from "../../utils/storage.js";
import * as aiRepository from "../ai/ai.repository.js";
import * as listingsRepository from "../listings/listings.repository.js";
import * as organizationsRepository from "../organizations/organizations.repository.js";
import * as notifications from "../notifications/notifications.service.js";
import * as repository from "./commerce.repository.js";
import { DEFAULT_FREE_AI_MONTHLY_QUOTA } from "../ai/ai.service.js";
import {
  DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME,
  DEFAULT_FREE_LISTING_LIMIT
} from "./entitlements.service.js";
import { renderInvoicePdf } from "./invoice.pdf.js";
import * as razorpayProvider from "./providers/razorpay.provider.js";
import { splitGstMinor } from "./tax.js";

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "dev-razorpay-key-id";
const razorpayKeySecret =
  process.env.RAZORPAY_KEY_SECRET || "dev-razorpay-secret-change-me";
const razorpayWebhookSecret =
  process.env.RAZORPAY_WEBHOOK_SECRET || razorpayKeySecret;
const razorpayApiTimeoutMs = Number(
  process.env.RAZORPAY_API_TIMEOUT_MS || 10000
);
// The base URL Razorpay redirects the customer's browser to after payment —
// must be our own deployed, publicly reachable API origin, not localhost, in
// any environment Razorpay can actually call back to.
const apiPublicBaseUrl =
  process.env.API_PUBLIC_BASE_URL ||
  `http://localhost:${process.env.PORT || 8080}`;
// Where we redirect the browser after handling the Payment Link callback.
const commerceReturnBaseUrl =
  process.env.COMMERCE_RETURN_BASE_URL || "http://localhost:3000";
// The invoice's "Sold By" block — this business's own GST registration.
// Its state-code prefix (first 2 digits) is also what decides CGST+SGST vs
// IGST on every invoice (see capturePaymentAndApplyEntitlements).
const invoiceSellerLegalName =
  process.env.INVOICE_SELLER_LEGAL_NAME || "Zameens Investments";
const invoiceSellerGstin =
  process.env.INVOICE_SELLER_GSTIN || "27DEVTESTGSTIN1Z5";
const invoiceSellerAddress =
  process.env.INVOICE_SELLER_ADDRESS || "Address not configured";
if (!isNonProductionEnv) {
  for (const [name, value] of [
    ["RAZORPAY_KEY_ID", process.env.RAZORPAY_KEY_ID],
    ["RAZORPAY_KEY_SECRET", process.env.RAZORPAY_KEY_SECRET],
    ["RAZORPAY_WEBHOOK_SECRET", process.env.RAZORPAY_WEBHOOK_SECRET],
    ["API_PUBLIC_BASE_URL", process.env.API_PUBLIC_BASE_URL],
    ["COMMERCE_RETURN_BASE_URL", process.env.COMMERCE_RETURN_BASE_URL],
    ["INVOICE_SELLER_LEGAL_NAME", process.env.INVOICE_SELLER_LEGAL_NAME],
    ["INVOICE_SELLER_GSTIN", process.env.INVOICE_SELLER_GSTIN],
    ["INVOICE_SELLER_ADDRESS", process.env.INVOICE_SELLER_ADDRESS]
  ])
    if (!value) throw new Error(`${name} is required in production`);
}

const orderNumber = () =>
  `ZMN-O-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .toUpperCase()}`;

const paymentResultUrl = ({ orderId, status }) => {
  const url = new URL("/payments/result", commerceReturnBaseUrl);
  if (orderId) url.searchParams.set("orderId", orderId);
  url.searchParams.set("status", status);
  return url.toString();
};

const toPlan = row =>
  row && {
    id: row.id,
    // The commerce.products id — this is what POST /orders items[].productId
    // must be, not this plan's own id. Public so a client can actually place
    // an order without a separate admin-only lookup.
    productId: row.productId,
    code: row.code,
    name: row.name,
    planType: row.planType,
    description: row.description,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    durationDays: row.durationDays,
    listingLimit: row.listingLimit,
    featuredDays: row.featuredDays,
    verificationIncluded: row.verificationIncluded,
    features: row.features || {},
    isActive: row.isActive,
    // NULL means unlimited AI Property Assistant questions for this plan.
    aiMonthlyQuota: row.aiMonthlyQuota
  };

const toPlanAdmin = row =>
  row && {
    ...toPlan(row),
    gstRateBps: row.gstRateBps,
    hsnSacCode: row.hsnSacCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };

export const listPlans = async audience =>
  (await repository.listActivePlans(audience)).map(toPlan);

export const getPlan = async planId => {
  const row = await repository.findPlanById(planId);
  if (!row) throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");
  return toPlan(row);
};

export const adminListPlans = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listPlansAdmin({
    ...filters,
    limit,
    offset
  });
  const { data: rows, total } = splitCountedRows(counted);
  return {
    data: rows.map(toPlanAdmin),
    meta: paginationMeta({ page, limit, total })
  };
};

export const adminGetPlan = async planId => {
  const row = await repository.findPlanById(planId);
  if (!row) throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");
  return toPlanAdmin(row);
};

export const createPlan = async input => {
  const existing = await repository.findPlanByCode(input.code);
  if (existing)
    throw new HttpError(
      409,
      "PLAN_CODE_EXISTS",
      "A plan with this code already exists."
    );
  const planId = await repository.createPlan(input);
  return getPlan(planId);
};

export const updatePlan = async ({ planId, changes }) => {
  const existing = await repository.findPlanById(planId);
  if (!existing)
    throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");

  if (Object.hasOwn(changes, "code") && changes.code !== existing.code) {
    if (await repository.planHasOrders(planId))
      throw new HttpError(
        409,
        "PLAN_CODE_LOCKED",
        "code cannot be changed after the plan has been purchased."
      );
    const duplicate = await repository.findPlanByCode(changes.code);
    if (duplicate && duplicate.id !== planId)
      throw new HttpError(
        409,
        "PLAN_CODE_EXISTS",
        "A plan with this code already exists."
      );
  }

  await repository.updatePlan({
    productId: existing.productId,
    planId,
    changes
  });
  return getPlan(planId);
};

export const setPlanActive = async (planId, isActive) => {
  const result = await repository.setPlanActive(planId, isActive);
  if (!result)
    throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");
  return getPlan(planId);
};

// What a logged-in user actually has right now — there was previously no
// endpoint for this at all; plan entitlement was only ever checked
// internally (e.g. for AI quota), never exposed to the buyer themselves.
// See mySubscription below for the fuller entitlement view (features,
// limits, and usage in one response). The client is expected to read `endsAt`
// and decide for itself when to show an "expiring soon" banner — there is no
// server-side push notification for this (see docs/razorpay-integration-plan.md).
export const myPlanSubscription = async actorId => {
  const row = await repository.findActiveSubscriptionForUser(actorId);
  if (!row)
    return {
      hasActivePlan: false,
      plan: null,
      status: null,
      startsAt: null,
      endsAt: null
    };
  return {
    hasActivePlan: true,
    plan: toPlan(row),
    status: row.subscriptionStatus,
    startsAt: row.startsAt,
    endsAt: row.endsAt
  };
};

// The ambient Free tier shown to a user with no active plan_subscription row
// at all — mirrors toPlan's shape so mySubscription's response is uniform
// whether or not the caller has ever purchased anything.
const FREE_PLAN_DEFAULTS = {
  id: null,
  productId: null,
  code: "PLAN_FREE",
  name: "Free",
  planType: "FREE",
  description: null,
  amountMinor: 0,
  currency: "INR",
  durationDays: null,
  listingLimit: DEFAULT_FREE_LISTING_LIMIT,
  featuredDays: null,
  verificationIncluded: false,
  // contactUnlocks mirrors entitlements.service.js#consumeContactUnlock's
  // own DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME fallback -- without it, this
  // display path would report contactUnlocks as unlimited (limit: null) while
  // enforcement still caps it at 5, the moment PLAN_FREE itself isn't seeded.
  features: { contactUnlocks: DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME },
  isActive: true,
  aiMonthlyQuota: DEFAULT_FREE_AI_MONTHLY_QUOTA
};

const limitBlock = (used, limit) =>
  limit === null || limit === undefined
    ? { used, limit: null }
    : { used, limit, remaining: Math.max(0, limit - used) };

// The acting user's own personal entitlement view — req.actor.id, not an
// org. This one response is what powers every UI surface that needs to show
// plan/usage (My Zameens, subscription page, upgrade banners, usage bars).
// Org dashboards (a channel-partner/org-admin view of an org's own
// plan/usage) are a parallel, out-of-scope-for-now endpoint — see
// docs/subscription-entitlements-implementation-plan.md §7.
export const mySubscription = async (actorId, { now } = {}) => {
  const active = await repository.resolveEffectivePlanForUser(actorId);
  const plan = active ? toPlan(active) : FREE_PLAN_DEFAULTS;
  // The single contactUnlocks allowance is lifetime on FREE and renews with
  // any paid plan. The plan type determines the period, avoiding duplicate
  // configuration keys for one entitlement.
  const contactUnlockLimit = plan.features.contactUnlocks ?? null;
  const contactUnlockPeriodMode =
    plan.planType === "FREE" ? "LIFETIME" : "MONTHLY";
  // Anchors every MONTHLY counter below to this user's own current plan's
  // starts_at (undefined when active is the ambient FREE_PLAN_DEFAULTS
  // fallback, which has no real subscription instance to anchor to --
  // resolveUsageCycle falls back to the calendar month there, same
  // last-resort behavior as everywhere else) -- see
  // entitlements.service.js#consumeContactUnlock/grantFeaturedListing, which
  // enforce against this exact same anchor.
  const anchorStartsAt = active?.startsAt;
  const [
    listingsUsed,
    aiUsed,
    featuredUsed,
    contactUnlocksUsed
  ] = await Promise.all([
    listingsRepository.countLiveForOwner({
      userId: actorId,
      organizationId: null
    }),
    aiRepository.countMonthlyUsageForUser(actorId, { anchorStartsAt, now }),
    repository.countSubscriptionUsageThisPeriod({
      userId: actorId,
      organizationId: null,
      feature: "FEATURED_LISTINGS",
      anchorStartsAt,
      now
    }),
    repository.countSubscriptionUsageThisPeriod({
      userId: actorId,
      organizationId: null,
      feature: "CONTACT_UNLOCKS",
      periodMode: contactUnlockPeriodMode,
      anchorStartsAt,
      now
    })
  ]);
  return {
    plan: {
      code: plan.code,
      name: plan.name,
      monthlyPrice: plan.amountMinor / 100
    },
    status: active ? active.subscriptionStatus : "ACTIVE",
    currentPeriodStart: active ? active.startsAt : null,
    currentPeriodEnd: active ? active.endsAt : null,
    features: plan.features,
    limits: {
      activeListings: limitBlock(listingsUsed, plan.listingLimit),
      imagesPerProperty: { limit: plan.features.imagesPerProperty ?? null },
      videosPerProperty: { limit: plan.features.videosPerProperty ?? null },
      featuredListings: limitBlock(
        featuredUsed,
        plan.features.featuredListingsPerMonth ?? null
      ),
      aiQueries: limitBlock(aiUsed, plan.aiMonthlyQuota),
      contactUnlocks: limitBlock(contactUnlocksUsed, contactUnlockLimit)
    }
  };
};

const toOrders = async rows => {
  if (!rows.length) return [];
  const itemRows = await repository.itemsForOrders(rows.map(row => row.id));
  const itemsByOrder = new Map();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) || [];
    list.push({
      productId: item.productId,
      code: item.code,
      name: item.name,
      quantity: item.quantity,
      unitAmountMinor: Number(item.unitAmountMinor),
      totalAmountMinor: Number(item.totalAmountMinor),
      targetType: item.metadata?.targetType ?? null,
      targetId: item.metadata?.targetId ?? null
    });
    itemsByOrder.set(item.orderId, list);
  }
  return rows.map(row => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    // Distinguishes "still waiting on the current attempt" from "the last
    // attempt failed, offer retry" while status itself stays PAYMENT_PENDING
    // for both (retries reuse the same order). null before any payment
    // attempt has been made.
    latestPaymentStatus: row.latestPaymentStatus || null,
    items: itemsByOrder.get(row.id) || [],
    subtotalMinor: Number(row.subtotalMinor),
    taxMinor: Number(row.taxMinor),
    totalMinor: Number(row.totalMinor),
    currency: row.currency,
    createdAt: row.createdAt,
    paidAt: row.paidAt
  }));
};
const toOrder = async row => (await toOrders([row]))[0];

// Validates one order item's target against the rules its product type requires
// (docs/razorpay-integration-plan.md Section 7). This is the only point where
// the buyer's identity and the target are both known ahead of any payment, so
// ownership cannot be deferred to capture/webhook time.
const validateOrderItemTarget = async ({
  product,
  item,
  actorId,
  organizationId
}) => {
  if (product.type === "PLAN") {
    if (item.targetType || item.targetId)
      throw new HttpError(
        400,
        "INVALID_TARGET",
        "PLAN items must not include a target."
      );
    return;
  }
  if (product.type === "PROMOTION") {
    if (item.targetType !== "LISTING" || !item.targetId)
      throw new HttpError(
        400,
        "INVALID_TARGET",
        "PROMOTION items require targetType LISTING and a targetId."
      );
    if (!product.promotionType || !product.promotionDurationDays)
      throw new HttpError(
        500,
        "PRODUCT_MISCONFIGURED",
        "This promotion product has no catalog configuration."
      );
    const listing = await repository.findOwnedListingForPromotion(
      item.targetId,
      {
        actorId,
        organizationId
      }
    );
    if (!listing)
      throw new HttpError(
        409,
        "TARGET_NOT_OWNED",
        "You do not own the listing you are promoting."
      );
    return;
  }
  if (product.type === "SERVICE") {
    if (item.targetType !== "SERVICE_REQUEST" || !item.targetId)
      throw new HttpError(
        400,
        "INVALID_TARGET",
        "SERVICE items require targetType SERVICE_REQUEST and a targetId."
      );
    const serviceRequest = await repository.findPayableServiceRequest(
      item.targetId,
      actorId
    );
    if (!serviceRequest)
      throw new HttpError(
        409,
        "SERVICE_REQUEST_NOT_PAYABLE",
        "This service request cannot be paid for."
      );
  }
};

export const createOrder = async ({ actorId, input }) => {
  if (input.organizationId) {
    const membership = await organizationsRepository.findMembership(
      input.organizationId,
      actorId
    );
    if (!membership || membership.status !== "ACTIVE")
      throw new HttpError(
        403,
        "ORGANIZATION_ACCESS_DENIED",
        "You are not an active member of that organisation."
      );
  }

  const productIds = [...new Set(input.items.map(item => item.productId))];
  const products = await repository.findProductsByIds(productIds);
  const productById = new Map(products.map(product => [product.id, product]));

  let subtotalMinor = 0;
  const items = [];
  for (const item of input.items) {
    const product = productById.get(item.productId);
    if (!product || !product.isActive)
      throw new HttpError(
        400,
        "INVALID_PRODUCT",
        `productId ${item.productId} is not a purchasable product.`
      );
    await validateOrderItemTarget({
      product,
      item,
      actorId,
      organizationId: input.organizationId
    });
    const unitAmountMinor = Number(product.amountMinor);
    const totalAmountMinor = unitAmountMinor * item.quantity;
    subtotalMinor += totalAmountMinor;
    items.push({
      ...item,
      unitAmountMinor,
      totalAmountMinor,
      gstRateBps: product.gstRateBps,
      hsnSacCode: product.hsnSacCode
    });
  }

  const taxMinor = 0;
  let orderId;
  try {
    orderId = await repository.createOrder({
      orderNumber: orderNumber(),
      userId: actorId,
      organizationId: input.organizationId,
      subtotalMinor,
      taxMinor,
      totalMinor: subtotalMinor + taxMinor,
      currency: "INR",
      items
    });
  } catch (error) {
    if (error.code === "SERVICE_REQUEST_NOT_PAYABLE")
      throw new HttpError(
        409,
        "SERVICE_REQUEST_NOT_PAYABLE",
        "This service request cannot be paid for."
      );
    throw error;
  }
  return getOrder(orderId);
};

export const getOrder = async orderId => {
  const row = await repository.findById(orderId);
  if (!row) throw new HttpError(404, "ORDER_NOT_FOUND", "Order was not found.");
  return toOrder(row);
};

export const orderForActor = async ({ orderId, actor }) => {
  const row = actor.roles?.includes("ADMIN")
    ? await repository.findById(orderId)
    : await repository.findOwnedByUser(orderId, actor.id);
  if (!row) throw new HttpError(404, "ORDER_NOT_FOUND", "Order was not found.");
  return toOrder(row);
};

const ownedOrderRow = async (orderId, actorId) => {
  const row = await repository.findOwnedByUser(orderId, actorId);
  if (!row) throw new HttpError(404, "ORDER_NOT_FOUND", "Order was not found.");
  return row;
};

// Same admin-or-owner visibility as orderForActor above. invoice_number is
// only ever set once an order is actually PAID (capturePaymentAndApplyEntitlements),
// so its absence here means "never paid" rather than "not generated yet" —
// there's nothing to lazily generate, the PDF is just re-rendered on demand
// from data already persisted at capture time.
export const generateOrderInvoice = async ({ orderId, actor }) => {
  const isAdmin = Boolean(actor.roles?.includes("ADMIN"));
  const row = await repository.findOrderInvoiceRow(
    orderId,
    isAdmin ? null : actor.id
  );
  if (!row) throw new HttpError(404, "ORDER_NOT_FOUND", "Order was not found.");
  if (!row.invoiceNumber)
    throw new HttpError(
      409,
      "INVOICE_NOT_AVAILABLE",
      "This order has not been paid yet."
    );

  // The order-level cgst/sgst/igst_minor columns only hold the *summed*
  // split (that's all capturePaymentAndApplyEntitlements needs to persist);
  // the per-line breakdown the PDF table shows is recomputed here from each
  // item's own snapshotted gstRateBps via the same pure splitGstMinor used
  // at capture time — deterministic, so it always matches the stored totals.
  const isIntraState = Number(row.igstMinor) === 0;
  const items = (await repository.itemsForOrders([row.id])).map(item => ({
    ...item,
    ...splitGstMinor({
      totalAmountMinor: item.totalAmountMinor,
      gstRateBps: item.gstRateBps,
      isIntraState
    })
  }));
  const buffer = await renderInvoicePdf({
    seller: {
      legalName: invoiceSellerLegalName,
      gstin: invoiceSellerGstin,
      address: invoiceSellerAddress
    },
    order: row,
    items
  });
  return { buffer, fileName: `${row.invoiceNumber}.pdf` };
};

export const listMyOrders = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForUser(actorId, filters, {
    limit,
    offset
  });
  const { data: rows, total } = splitCountedRows(counted);
  return {
    data: await toOrders(rows),
    meta: paginationMeta({ page, limit, total })
  };
};

export const createPaymentIntent = async ({ actorId, orderId, input }) => {
  const order = await ownedOrderRow(orderId, actorId);
  if (order.status === "PAID")
    throw new HttpError(
      409,
      "ORDER_ALREADY_PAID",
      "Order has already been paid."
    );
  if (!["CREATED", "PAYMENT_PENDING"].includes(order.status))
    throw new HttpError(
      409,
      "ORDER_NOT_PAYABLE",
      "Order cannot accept payment in its current state."
    );

  // Explicitly fail any still-open attempt before starting a fresh one, and
  // best-effort cancel it on Razorpay's side too — otherwise the old Payment
  // Link stays payable there (e.g. a bookmarked tab or the browser back
  // button) even after we've moved the order onto a new one, and a customer
  // completing both would be charged twice for the same order (Section 8 of
  // docs/razorpay-integration-plan.md). A cancel failing (already paid,
  // already cancelled, provider hiccup) must never block issuing the fresh
  // attempt, so this only logs.
  const stalePayments = await repository.failActivePaymentsForOrder(order.id);
  await Promise.all(
    stalePayments
      .filter(stale => stale.providerOrderId)
      .map(stale =>
        razorpayProvider
          .cancelPaymentLink({
            keyId: razorpayKeyId,
            keySecret: razorpayKeySecret,
            timeoutMs: razorpayApiTimeoutMs,
            providerOrderId: stale.providerOrderId
          })
          .catch(error =>
            logger.warn(
              `Could not cancel stale Razorpay payment link ${stale.providerOrderId} ` +
                `for order ${order.id}: ${error.message}`
            )
          )
      )
  );

  // Generated up front so it can be embedded in the Payment Link's notes
  // before the payments row exists — this is how the webhook/callback
  // handlers resolve back to an internal payment without depending on
  // Razorpay's exact order-id/payment-link-id field naming per event type.
  const paymentId = randomUUID();
  const link = await razorpayProvider.createPaymentLink({
    keyId: razorpayKeyId,
    keySecret: razorpayKeySecret,
    timeoutMs: razorpayApiTimeoutMs,
    amountMinor: Number(order.totalMinor),
    currency: order.currency,
    // Razorpay enforces reference_id uniqueness per account, so this must be
    // unique per payment *attempt*, not per order — order.orderNumber would
    // make every retry after the first fail with "reference_id already
    // exists" (confirmed against the live API), defeating the fail-and-retry
    // flow above. The internal payment id is fresh on every attempt and is
    // never compared against anything downstream, so this is a safe swap.
    referenceId: paymentId,
    description: `Zameens order ${order.orderNumber}`,
    callbackUrl: `${apiPublicBaseUrl}/api/v1/payments/callback`,
    notes: { internalOrderId: order.id, internalPaymentId: paymentId }
  });

  const payment = await repository.createPayment({
    id: paymentId,
    orderId: order.id,
    provider: input.provider,
    providerOrderId: link.id,
    amountMinor: Number(order.totalMinor),
    currency: order.currency
  });
  if (order.status !== "PAYMENT_PENDING")
    await repository.setOrderStatus(order.id, "PAYMENT_PENDING");

  return {
    paymentId: payment.id,
    provider: payment.provider,
    redirectUrl: link.shortUrl
  };
};

// Shared amount/currency/capture-state guard applied on both the Payment
// Link callback and the webhook path (Phase 2 of
// docs/razorpay-integration-plan.md) so neither path ever marks a payment
// captured on the provider's word alone — what Razorpay reports for the
// payment must match what we quoted when the Payment Link was created, and
// Razorpay must actually consider it captured.
export const paymentMatchesProvider = ({
  payment,
  providerAmountMinor,
  providerCurrency,
  providerStatus
}) =>
  providerStatus === "captured" &&
  Number(providerAmountMinor) === Number(payment.amountMinor) &&
  String(providerCurrency || "").toUpperCase() ===
    String(payment.currency || "").toUpperCase();

// Fired once a payment is actually captured, from both the callback and
// webhook paths — previously neither notified the buyer at all.
// notifications.notifyUser is itself best-effort (never throws), matching
// the existing convention elsewhere (enquiries/site-visits notifications).
const notifyPaymentCaptured = captured =>
  notifications.notifyUser(captured.userId, {
    type: "PAYMENT_CAPTURED",
    title: "Payment successful",
    body: "Your payment was received and your order is now active.",
    data: { paymentId: captured.id, orderId: captured.orderId }
  });

// Handles the browser landing back on our Payment Link callback_url. Always
// resolves to a redirect target, never throws — Razorpay/the browser is
// making a plain GET here with no Authorization header, so there is no JSON
// error response to usefully return (Section 10 of the integration plan).
export const paymentCallback = async ({ query }) => {
  const { paymentId, paymentLinkId, referenceId, status, signature } = query;
  if (!paymentId || !paymentLinkId || !referenceId || !status || !signature)
    return { redirectUrl: paymentResultUrl({ status: "invalid" }) };

  const signatureValid = razorpayProvider.verifyPaymentLinkCallbackSignature({
    query: {
      razorpay_payment_id: paymentId,
      razorpay_payment_link_id: paymentLinkId,
      razorpay_payment_link_reference_id: referenceId,
      razorpay_payment_link_status: status,
      razorpay_signature: signature
    },
    keySecret: razorpayKeySecret
  });
  if (!signatureValid)
    return { redirectUrl: paymentResultUrl({ status: "invalid" }) };

  const payment = await repository.findPaymentByProviderOrderId(
    "RAZORPAY",
    paymentLinkId
  );
  if (!payment) return { redirectUrl: paymentResultUrl({ status: "invalid" }) };

  if (payment.status !== "CAPTURED" && status === "paid") {
    try {
      // The callback query carries no amount/currency, only a signed status
      // — fetch the payment itself from Razorpay so this path cannot capture
      // on a client-supplied status alone (Section 16/18 of the integration
      // plan: "no client-controlled amount can be charged or marked paid").
      const providerPayment = await razorpayProvider.fetchPayment({
        keyId: razorpayKeyId,
        keySecret: razorpayKeySecret,
        timeoutMs: razorpayApiTimeoutMs,
        providerPaymentId: paymentId
      });
      if (
        !paymentMatchesProvider({
          payment,
          providerAmountMinor: providerPayment?.amount,
          providerCurrency: providerPayment?.currency,
          providerStatus: providerPayment?.status
        })
      )
        return {
          redirectUrl: paymentResultUrl({
            orderId: payment.orderId,
            status: "pending"
          })
        };

      const captured = await repository.capturePaymentAndApplyEntitlements({
        id: payment.id,
        orderId: payment.orderId,
        providerPaymentId: paymentId,
        providerPayload: {
          source: "payment_link_callback",
          query,
          providerPayment
        },
        sellerGstin: invoiceSellerGstin
      });
      await notifyPaymentCaptured(captured);
    } catch {
      // The webhook is authoritative and will retry this independently — the
      // browser must still get a redirect, not a raw error page, so surface
      // a "pending" status rather than letting this throw out of the handler.
      return {
        redirectUrl: paymentResultUrl({
          orderId: payment.orderId,
          status: "pending"
        })
      };
    }
  }

  return {
    redirectUrl: paymentResultUrl({
      orderId: payment.orderId,
      status: status === "paid" ? "success" : status
    })
  };
};

const toPaymentAdmin = row =>
  row && {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    orderStatus: row.orderStatus,
    invoiceNumber: row.invoiceNumber,
    provider: row.provider,
    providerOrderId: row.providerOrderId,
    providerPaymentId: row.providerPaymentId,
    status: row.status,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    organizationId: row.organizationId,
    buyer: {
      userId: row.userId,
      name: row.buyerName,
      phone: row.buyerPhone,
      email: row.buyerEmail
    }
  };

// Full detail view: everything the list gives plus the raw provider payload
// (the gateway's own last-known response), the order's line items, and the
// full webhook delivery trace for this payment — so an admin never has to
// cross-reference commerce.orders or re-parse payment_webhook_events
// payloads separately to see exactly what was bought and what the gateway
// actually sent, in order, including deliveries that failed to process.
const toPaymentAdminDetail = async row => {
  const [itemRows, webhookEvents] = await Promise.all([
    repository.itemsForOrders([row.orderId]),
    repository.findWebhookEventsByPaymentId(row.id)
  ]);
  return {
    ...toPaymentAdmin(row),
    updatedAt: row.updatedAt,
    providerPayload: row.providerPayload || null,
    order: {
      subtotalMinor: Number(row.orderSubtotalMinor),
      taxMinor: Number(row.orderTaxMinor),
      totalMinor: Number(row.orderTotalMinor),
      items: itemRows.map(item => ({
        productId: item.productId,
        code: item.code,
        name: item.name,
        quantity: item.quantity,
        unitAmountMinor: Number(item.unitAmountMinor),
        totalAmountMinor: Number(item.totalAmountMinor)
      }))
    },
    webhookEvents: webhookEvents.map(event => ({
      id: event.id,
      eventType: event.eventType,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
      processingError: event.processingError,
      payload: event.payload
    }))
  };
};

export const adminListPayments = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listPaymentsAdmin(filters, {
    limit,
    offset
  });
  const { data: rows, total } = splitCountedRows(counted);
  return {
    data: rows.map(toPaymentAdmin),
    meta: paginationMeta({ page, limit, total })
  };
};

export const adminGetPayment = async paymentId => {
  const row = await repository.findPaymentByIdAdmin(paymentId);
  if (!row)
    throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment was not found.");
  return toPaymentAdminDetail(row);
};

const capturableWebhookEvents = new Set([
  "payment.captured",
  "payment_link.paid"
]);

export const handleWebhook = async ({ signatureHeader, rawBody, body }) => {
  const provider = "RAZORPAY";
  const signatureValid = razorpayProvider.verifyWebhookSignature({
    rawBody,
    signature: signatureHeader,
    secret: razorpayWebhookSecret
  });
  if (!signatureValid)
    throw new HttpError(
      400,
      "WEBHOOK_SIGNATURE_INVALID",
      "Webhook signature could not be verified."
    );

  const eventType = body?.event || "UNKNOWN";
  const eventId =
    body?.id || sha256(rawBody?.length ? rawBody : JSON.stringify(body || {}));
  // Resolved via the notes we set ourselves at Payment Link creation time,
  // not via order_id/payment_link_id field names on the webhook payload —
  // those differ by event type in ways not worth depending on here. Resolved
  // once, up front, so the same lookup both links this delivery to its
  // payment row (commerce.payment_webhook_events.payment_id, for admin
  // traceability) and is reused in the capture/fail branches below instead
  // of querying twice.
  const paymentEntity = body?.payload?.payment?.entity;
  const internalPaymentId = paymentEntity?.notes?.internalPaymentId || null;
  const payment = internalPaymentId
    ? await repository.findPaymentById(internalPaymentId)
    : null;

  const event = await repository.insertWebhookEvent({
    provider,
    eventId,
    eventType,
    payload: body,
    paymentId: payment?.id ?? null
  });
  if (!event) return { received: true, duplicate: true };

  try {
    if (
      payment &&
      capturableWebhookEvents.has(eventType) &&
      payment.status !== "CAPTURED"
    ) {
      // Never trust the event type alone — confirm the payment entity's own
      // amount, currency, and status against what we quoted when the
      // Payment Link was created before marking anything captured.
      if (
        !paymentMatchesProvider({
          payment,
          providerAmountMinor: paymentEntity?.amount,
          providerCurrency: paymentEntity?.currency,
          providerStatus: paymentEntity?.status
        })
      )
        throw new HttpError(
          409,
          "PAYMENT_MISMATCH",
          "Webhook payment amount, currency, or status does not match the recorded payment."
        );
      const captured = await repository.capturePaymentAndApplyEntitlements({
        id: payment.id,
        orderId: payment.orderId,
        providerPaymentId: paymentEntity.id,
        providerPayload: body,
        sellerGstin: invoiceSellerGstin
      });
      await notifyPaymentCaptured(captured);
    } else if (
      payment &&
      eventType === "payment.failed" &&
      payment.status === "CREATED"
    ) {
      const failed = await repository.failPayment({
        id: payment.id,
        providerPayload: body
      });
      if (!failed.ok) throw failed.error;
    }
    await repository.markWebhookProcessed(event.id);
  } catch (error) {
    await repository.markWebhookProcessed(event.id, error.message);
    throw error;
  }

  return { received: true, duplicate: false };
};

const toServiceItem = row =>
  row && {
    id: row.id,
    // The commerce.products id — this is what POST /orders items[].productId
    // must be, not this service catalog entry's own id.
    productId: row.productId,
    code: row.code,
    serviceType: row.serviceType,
    name: row.name,
    description: row.description,
    amountMinor: Number(row.amountMinor),
    requiresProperty: row.requiresProperty,
    requiresDocuments: row.requiresDocuments,
    isActive: row.isActive
  };

export const listServices = async serviceType =>
  (await repository.listActiveServices(serviceType)).map(toServiceItem);

export const getService = async serviceId => {
  const row = await repository.findServiceById(serviceId);
  if (!row)
    throw new HttpError(404, "SERVICE_NOT_FOUND", "Service was not found.");
  return toServiceItem(row);
};

const serviceFileResponse = async file => ({
  id: file.id,
  fileName: file.fileName,
  mimeType: file.mimeType,
  fileSizeBytes: Number(file.fileSizeBytes),
  downloadUrl: await signedReadUrl(file.storageKey)
});

const toServiceRequests = async (rows, { includeInternal = false } = {}) => {
  if (!rows.length) return [];
  const [services, fileRows] = await Promise.all([
    repository.servicesByIds([...new Set(rows.map(row => row.serviceId))]),
    repository.filesForServiceRequests(rows.map(row => row.id))
  ]);
  const serviceById = new Map(
    services.map(row => [row.id, toServiceItem(row)])
  );
  const filesByRequest = new Map();
  for (const file of fileRows) {
    const list = filesByRequest.get(file.serviceRequestId) || [];
    list.push(file);
    filesByRequest.set(file.serviceRequestId, list);
  }
  return Promise.all(
    rows.map(async row => ({
      id: row.id,
      service: serviceById.get(row.serviceId) || null,
      propertyId: row.propertyId,
      listingId: row.listingId,
      status: row.status,
      orderId: row.orderId,
      customerNotes: row.customerNotes,
      files: await Promise.all(
        (filesByRequest.get(row.id) || []).map(serviceFileResponse)
      ),
      reportDownloadUrl:
        row.status === "COMPLETED" && row.completedReportStorageKey
          ? await signedReadUrl(row.completedReportStorageKey)
          : null,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      ...(includeInternal
        ? {
            assignedToUserId: row.assignedToUserId,
            internalNotes: row.internalNotes,
            contactPhone: row.contactPhone,
            contactEmail: row.contactEmail,
            reportSummary: row.reportSummary
          }
        : {})
    }))
  );
};
const toServiceRequest = async (row, opts) =>
  (await toServiceRequests([row], opts))[0];

export const createServiceRequest = async ({ actorId, input }) => {
  const service = await repository.findServiceById(input.serviceId);
  if (!service || !service.isActive)
    throw new HttpError(
      400,
      "INVALID_SERVICE",
      "serviceId is not a purchasable service."
    );
  if (service.requiresProperty && !input.propertyId)
    throw new HttpError(
      400,
      "PROPERTY_REQUIRED",
      "propertyId is required for this service."
    );

  const result = await repository.createServiceRequest({
    serviceId: input.serviceId,
    userId: actorId,
    propertyId: input.propertyId,
    listingId: input.listingId,
    customerNotes: input.customerNotes,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail
  });
  if (!result.ok) {
    if (result.error?.code === "23503")
      throw new HttpError(
        400,
        "INVALID_REFERENCE",
        "propertyId or listingId does not exist."
      );
    throw result.error;
  }
  return toServiceRequest(result.data);
};

export const ownedServiceRequest = async (requestId, actorId) => {
  const row = await repository.findServiceRequestOwnedByUser(
    requestId,
    actorId
  );
  if (!row)
    throw new HttpError(
      404,
      "SERVICE_REQUEST_NOT_FOUND",
      "Service request was not found."
    );
  return row;
};

export const serviceRequestForActor = async ({ requestId, actor }) => {
  const isAdmin = Boolean(actor.roles?.includes("ADMIN"));
  const row = isAdmin
    ? await repository.findServiceRequestById(requestId)
    : await repository.findServiceRequestOwnedByUser(requestId, actor.id);
  if (!row)
    throw new HttpError(
      404,
      "SERVICE_REQUEST_NOT_FOUND",
      "Service request was not found."
    );
  return toServiceRequest(row, { includeInternal: isAdmin });
};

export const myServiceRequests = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listServiceRequestsForUser(
    actorId,
    filters,
    { limit, offset }
  );
  const { data: rows, total } = splitCountedRows(counted);
  return {
    data: await toServiceRequests(rows),
    meta: paginationMeta({ page, limit, total })
  };
};

export const createServiceRequestFileUpload = ({ requestId, input }) =>
  signedWriteUrl({
    storageKey: createServiceRequestStorageKey({
      requestId,
      fileName: input.fileName
    }),
    mimeType: input.mimeType
  });

export const completeServiceRequestFile = async ({
  requestId,
  actorId,
  input
}) => {
  if (!belongsToServiceRequest({ requestId, storageKey: input.storageKey }))
    throw new HttpError(
      400,
      "INVALID_STORAGE_KEY",
      "storageKey does not belong to this service request upload."
    );
  const file = await repository.insertServiceRequestFile({
    serviceRequestId: requestId,
    storageKey: input.storageKey,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileSizeBytes: input.fileSizeBytes,
    uploadedByUserId: actorId
  });
  return serviceFileResponse(file);
};

export const listServiceRequestsAdmin = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listServiceRequestsAdmin(filters, {
    limit,
    offset
  });
  const { data: rows, total } = splitCountedRows(counted);
  return {
    data: await toServiceRequests(rows, { includeInternal: true }),
    meta: paginationMeta({ page, limit, total })
  };
};

export const adminGetServiceRequest = async requestId => {
  const row = await repository.findServiceRequestById(requestId);
  if (!row)
    throw new HttpError(
      404,
      "SERVICE_REQUEST_NOT_FOUND",
      "Service request was not found."
    );
  return toServiceRequest(row, { includeInternal: true });
};

const reportableStates = new Set([
  "REQUESTED",
  "PAYMENT_PENDING",
  "IN_PROGRESS",
  "DOCUMENTS_REQUIRED"
]);

export const updateServiceRequestStatus = async ({ requestId, changes }) => {
  const existing = await repository.findServiceRequestById(requestId);
  if (!existing)
    throw new HttpError(
      404,
      "SERVICE_REQUEST_NOT_FOUND",
      "Service request was not found."
    );
  const result = await repository.setServiceRequestStatus({
    id: requestId,
    status: changes.status,
    internalNote: changes.internalNote
  });
  if (!result.ok) throw result.error;
  return toServiceRequest(result.data, { includeInternal: true });
};

export const createServiceReportUpload = async ({ requestId, input }) => {
  const existing = await repository.findServiceRequestById(requestId);
  if (!existing)
    throw new HttpError(
      404,
      "SERVICE_REQUEST_NOT_FOUND",
      "Service request was not found."
    );
  return signedWriteUrl({
    storageKey: createServiceReportStorageKey({
      requestId,
      fileName: input.fileName
    }),
    mimeType: input.mimeType
  });
};

export const submitServiceReport = async ({ requestId, input }) => {
  const existing = await repository.findServiceRequestById(requestId);
  if (!existing)
    throw new HttpError(
      404,
      "SERVICE_REQUEST_NOT_FOUND",
      "Service request was not found."
    );
  if (!reportableStates.has(existing.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Service request cannot be marked completed from its current state."
    );
  if (!belongsToServiceReport({ requestId, storageKey: input.storageKey }))
    throw new HttpError(
      400,
      "INVALID_STORAGE_KEY",
      "storageKey does not belong to this service request's report upload."
    );
  const result = await repository.setServiceRequestReport({
    id: requestId,
    storageKey: input.storageKey,
    summary: input.summary
  });
  if (!result.ok) throw result.error;
  return toServiceRequest(result.data, { includeInternal: true });
};

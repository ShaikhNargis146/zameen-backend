import { randomUUID } from "crypto";
import { isNonProductionEnv } from "../../config/env.js";
import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
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
import * as notifications from "../notifications/notifications.service.js";
import * as organizationsRepository from "../organizations/organizations.repository.js";
import * as repository from "./commerce.repository.js";
import * as razorpayProvider from "./providers/razorpay.provider.js";

// How long before a plan's endsAt to send the one-time "expiring soon" reminder.
const planExpiryReminderDays = Number(process.env.PLAN_EXPIRY_REMINDER_DAYS || 3);

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "dev-razorpay-key-id";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "dev-razorpay-secret-change-me";
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || razorpayKeySecret;
const razorpayApiTimeoutMs = Number(process.env.RAZORPAY_API_TIMEOUT_MS || 10000);
// The base URL Razorpay redirects the customer's browser to after payment —
// must be our own deployed, publicly reachable API origin, not localhost, in
// any environment Razorpay can actually call back to.
const apiPublicBaseUrl = process.env.API_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
// Where we redirect the browser after handling the Payment Link callback.
const commerceReturnBaseUrl = process.env.COMMERCE_RETURN_BASE_URL || "http://localhost:3000";
if (!isNonProductionEnv) {
  for (const [name, value] of [
    ["RAZORPAY_KEY_ID", process.env.RAZORPAY_KEY_ID],
    ["RAZORPAY_KEY_SECRET", process.env.RAZORPAY_KEY_SECRET],
    ["RAZORPAY_WEBHOOK_SECRET", process.env.RAZORPAY_WEBHOOK_SECRET],
    ["API_PUBLIC_BASE_URL", process.env.API_PUBLIC_BASE_URL],
    ["COMMERCE_RETURN_BASE_URL", process.env.COMMERCE_RETURN_BASE_URL]
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
    billingMode: row.billingMode,
    // NULL means unlimited AI Property Assistant questions for this plan.
    aiMonthlyQuota: row.aiMonthlyQuota
  };

const toPlanAdmin = row =>
  row && {
    ...toPlan(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };

export const listPlans = async audience => (await repository.listActivePlans(audience)).map(toPlan);

export const getPlan = async planId => {
  const row = await repository.findPlanById(planId);
  if (!row) throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");
  return toPlan(row);
};

export const adminListPlans = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listPlansAdmin({ ...filters, limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: rows.map(toPlanAdmin), meta: paginationMeta({ page, limit, total }) };
};

export const adminGetPlan = async planId => {
  const row = await repository.findPlanById(planId);
  if (!row) throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");
  return toPlanAdmin(row);
};

export const createPlan = async input => {
  const existing = await repository.findPlanByCode(input.code);
  if (existing)
    throw new HttpError(409, "PLAN_CODE_EXISTS", "A plan with this code already exists.");
  const planId = await repository.createPlan(input);
  return getPlan(planId);
};

export const updatePlan = async ({ planId, changes }) => {
  const existing = await repository.findPlanById(planId);
  if (!existing) throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");

  if (Object.hasOwn(changes, "code") && changes.code !== existing.code) {
    if (await repository.planHasOrders(planId))
      throw new HttpError(
        409,
        "PLAN_CODE_LOCKED",
        "code cannot be changed after the plan has been purchased."
      );
    const duplicate = await repository.findPlanByCode(changes.code);
    if (duplicate && duplicate.id !== planId)
      throw new HttpError(409, "PLAN_CODE_EXISTS", "A plan with this code already exists.");
  }

  await repository.updatePlan({ productId: existing.productId, planId, changes });
  return getPlan(planId);
};

export const setPlanActive = async (planId, isActive) => {
  const result = await repository.setPlanActive(planId, isActive);
  if (!result) throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");
  return getPlan(planId);
};

// What a logged-in user actually has right now — there was previously no
// endpoint for this at all; plan entitlement was only ever checked
// internally (e.g. ai.repository.activePlanForUser for AI quota), never
// exposed to the buyer themselves.
export const myPlanSubscription = async actorId => {
  const row = await repository.findActiveSubscriptionForUser(actorId);
  if (!row) return { hasActivePlan: false, plan: null, status: null, startsAt: null, endsAt: null };
  return {
    hasActivePlan: true,
    plan: toPlan(row),
    status: row.subscriptionStatus,
    startsAt: row.startsAt,
    endsAt: row.endsAt
  };
};

// Moves lapsed subscriptions from ACTIVE to EXPIRED and tells the user it
// happened. Run on a timer (see src/index.js) rather than only at the next
// purchase, since a user who never repurchases would otherwise never be told.
export const expirePlanSubscriptions = async () => {
  const expired = await repository.expireLapsedPlanSubscriptions();
  await Promise.all(
    expired.map(row =>
      notifications.notifyUser(row.userId, {
        type: "PLAN_EXPIRED",
        title: "Your plan has expired",
        body: `Your ${row.planName} plan has expired. Renew to keep your plan benefits active.`,
        data: { planSubscriptionId: row.id }
      })
    )
  );
  if (expired.length)
    logger.info(`Expired ${expired.length} plan subscription(s) past their endsAt.`);
  return expired.length;
};

// One-time heads-up before a plan lapses, so expiry isn't the first the user
// hears of it. Idempotent across runs — see findExpiringSoonSubscriptions.
export const remindExpiringPlanSubscriptions = async () => {
  const expiringSoon = await repository.findExpiringSoonSubscriptions(planExpiryReminderDays);
  await Promise.all(
    expiringSoon.map(row =>
      notifications.notifyUser(row.userId, {
        type: "PLAN_EXPIRING_SOON",
        title: "Your plan is expiring soon",
        body: `Your ${row.planName} plan expires on ${new Date(row.endsAt).toDateString()}. Renew to avoid interruption.`,
        data: { planSubscriptionId: row.id, endsAt: row.endsAt }
      })
    )
  );
  if (expiringSoon.length)
    logger.info(`Sent expiring-soon reminder for ${expiringSoon.length} plan subscription(s).`);
  return expiringSoon.length;
};

export const sweepPlanSubscriptions = async () => {
  const [expiredCount, remindedCount] = await Promise.all([
    expirePlanSubscriptions(),
    remindExpiringPlanSubscriptions()
  ]);
  return { expiredCount, remindedCount };
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
const validateOrderItemTarget = async ({ product, item, actorId, organizationId }) => {
  if (product.type === "PLAN") {
    if (item.targetType || item.targetId)
      throw new HttpError(400, "INVALID_TARGET", "PLAN items must not include a target.");
    if (product.billingMode === "RECURRING")
      throw new HttpError(
        409,
        "PLAN_REQUIRES_SUBSCRIPTION",
        "This plan is billed as a recurring subscription and cannot be purchased as a one-time order."
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
    const listing = await repository.findOwnedListingForPromotion(item.targetId, {
      actorId,
      organizationId
    });
    if (!listing)
      throw new HttpError(409, "TARGET_NOT_OWNED", "You do not own the listing you are promoting.");
    return;
  }
  if (product.type === "SERVICE") {
    if (item.targetType !== "SERVICE_REQUEST" || !item.targetId)
      throw new HttpError(
        400,
        "INVALID_TARGET",
        "SERVICE items require targetType SERVICE_REQUEST and a targetId."
      );
    const serviceRequest = await repository.findPayableServiceRequest(item.targetId, actorId);
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
    const membership = await organizationsRepository.findMembership(input.organizationId, actorId);
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
    await validateOrderItemTarget({ product, item, actorId, organizationId: input.organizationId });
    const unitAmountMinor = Number(product.amountMinor);
    const totalAmountMinor = unitAmountMinor * item.quantity;
    subtotalMinor += totalAmountMinor;
    items.push({ ...item, unitAmountMinor, totalAmountMinor });
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

export const listMyOrders = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForUser(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: await toOrders(rows), meta: paginationMeta({ page, limit, total }) };
};

export const createPaymentIntent = async ({ actorId, orderId, input }) => {
  const order = await ownedOrderRow(orderId, actorId);
  if (order.status === "PAID")
    throw new HttpError(409, "ORDER_ALREADY_PAID", "Order has already been paid.");
  if (!["CREATED", "PAYMENT_PENDING"].includes(order.status))
    throw new HttpError(
      409,
      "ORDER_NOT_PAYABLE",
      "Order cannot accept payment in its current state."
    );

  // Explicitly fail any still-open attempt before starting a fresh one,
  // rather than trying to determine whether Razorpay still considers the old
  // Payment Link usable (Section 8 of docs/razorpay-integration-plan.md).
  await repository.failActivePaymentsForOrder(order.id);

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
  if (order.status !== "PAYMENT_PENDING") await repository.setOrderStatus(order.id, "PAYMENT_PENDING");

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
  String(providerCurrency || "").toUpperCase() === String(payment.currency || "").toUpperCase();

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
  if (!signatureValid) return { redirectUrl: paymentResultUrl({ status: "invalid" }) };

  const payment = await repository.findPaymentByProviderOrderId("RAZORPAY", paymentLinkId);
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
        return { redirectUrl: paymentResultUrl({ orderId: payment.orderId, status: "pending" }) };

      await repository.capturePaymentAndApplyEntitlements({
        id: payment.id,
        orderId: payment.orderId,
        providerPaymentId: paymentId,
        providerPayload: { source: "payment_link_callback", query, providerPayment }
      });
    } catch {
      // The webhook is authoritative and will retry this independently — the
      // browser must still get a redirect, not a raw error page, so surface
      // a "pending" status rather than letting this throw out of the handler.
      return { redirectUrl: paymentResultUrl({ orderId: payment.orderId, status: "pending" }) };
    }
  }

  return {
    redirectUrl: paymentResultUrl({
      orderId: payment.orderId,
      status: status === "paid" ? "success" : status
    })
  };
};

const capturableWebhookEvents = new Set(["payment.captured", "payment_link.paid"]);

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
  const eventId = body?.id || sha256(rawBody?.length ? rawBody : JSON.stringify(body || {}));
  const event = await repository.insertWebhookEvent({ provider, eventId, eventType, payload: body });
  if (!event) return { received: true, duplicate: true };

  try {
    const paymentEntity = body?.payload?.payment?.entity;
    // Resolved via the notes we set ourselves at Payment Link creation time,
    // not via order_id/payment_link_id field names on the webhook payload —
    // those differ by event type in ways not worth depending on here.
    const internalPaymentId = paymentEntity?.notes?.internalPaymentId;

    if (internalPaymentId && capturableWebhookEvents.has(eventType)) {
      const payment = await repository.findPaymentById(internalPaymentId);
      if (payment && payment.status !== "CAPTURED") {
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
        await repository.capturePaymentAndApplyEntitlements({
          id: payment.id,
          orderId: payment.orderId,
          providerPaymentId: paymentEntity.id,
          providerPayload: body
        });
      }
    } else if (internalPaymentId && eventType === "payment.failed") {
      const payment = await repository.findPaymentById(internalPaymentId);
      if (payment && payment.status === "CREATED") {
        const failed = await repository.failPayment({ id: payment.id, providerPayload: body });
        if (!failed.ok) throw failed.error;
      }
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
  if (!row) throw new HttpError(404, "SERVICE_NOT_FOUND", "Service was not found.");
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
  const serviceById = new Map(services.map(row => [row.id, toServiceItem(row)]));
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
      files: await Promise.all((filesByRequest.get(row.id) || []).map(serviceFileResponse)),
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
const toServiceRequest = async (row, opts) => (await toServiceRequests([row], opts))[0];

export const createServiceRequest = async ({ actorId, input }) => {
  const service = await repository.findServiceById(input.serviceId);
  if (!service || !service.isActive)
    throw new HttpError(400, "INVALID_SERVICE", "serviceId is not a purchasable service.");
  if (service.requiresProperty && !input.propertyId)
    throw new HttpError(400, "PROPERTY_REQUIRED", "propertyId is required for this service.");

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
      throw new HttpError(400, "INVALID_REFERENCE", "propertyId or listingId does not exist.");
    throw result.error;
  }
  return toServiceRequest(result.data);
};

export const ownedServiceRequest = async (requestId, actorId) => {
  const row = await repository.findServiceRequestOwnedByUser(requestId, actorId);
  if (!row) throw new HttpError(404, "SERVICE_REQUEST_NOT_FOUND", "Service request was not found.");
  return row;
};

export const serviceRequestForActor = async ({ requestId, actor }) => {
  const isAdmin = Boolean(actor.roles?.includes("ADMIN"));
  const row = isAdmin
    ? await repository.findServiceRequestById(requestId)
    : await repository.findServiceRequestOwnedByUser(requestId, actor.id);
  if (!row) throw new HttpError(404, "SERVICE_REQUEST_NOT_FOUND", "Service request was not found.");
  return toServiceRequest(row, { includeInternal: isAdmin });
};

export const myServiceRequests = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listServiceRequestsForUser(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return { data: await toServiceRequests(rows), meta: paginationMeta({ page, limit, total }) };
};

export const createServiceRequestFileUpload = ({ requestId, input }) =>
  signedWriteUrl({
    storageKey: createServiceRequestStorageKey({ requestId, fileName: input.fileName }),
    mimeType: input.mimeType
  });

export const completeServiceRequestFile = async ({ requestId, actorId, input }) => {
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
  const counted = await repository.listServiceRequestsAdmin(filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  return {
    data: await toServiceRequests(rows, { includeInternal: true }),
    meta: paginationMeta({ page, limit, total })
  };
};

export const adminGetServiceRequest = async requestId => {
  const row = await repository.findServiceRequestById(requestId);
  if (!row) throw new HttpError(404, "SERVICE_REQUEST_NOT_FOUND", "Service request was not found.");
  return toServiceRequest(row, { includeInternal: true });
};

const reportableStates = new Set(["REQUESTED", "PAYMENT_PENDING", "IN_PROGRESS", "DOCUMENTS_REQUIRED"]);

export const updateServiceRequestStatus = async ({ requestId, changes }) => {
  const existing = await repository.findServiceRequestById(requestId);
  if (!existing) throw new HttpError(404, "SERVICE_REQUEST_NOT_FOUND", "Service request was not found.");
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
  if (!existing) throw new HttpError(404, "SERVICE_REQUEST_NOT_FOUND", "Service request was not found.");
  return signedWriteUrl({
    storageKey: createServiceReportStorageKey({ requestId, fileName: input.fileName }),
    mimeType: input.mimeType
  });
};

export const submitServiceReport = async ({ requestId, input }) => {
  const existing = await repository.findServiceRequestById(requestId);
  if (!existing) throw new HttpError(404, "SERVICE_REQUEST_NOT_FOUND", "Service request was not found.");
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

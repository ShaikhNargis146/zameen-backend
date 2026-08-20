import { randomUUID } from "crypto";
import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import { hmacSha256Hex, randomToken, safeEqualHex, sha256 } from "../../utils/crypto.js";
import {
  belongsToServiceRequest,
  createServiceRequestStorageKey,
  signedReadUrl,
  signedWriteUrl
} from "../../utils/storage.js";
import * as organizationsRepository from "../organizations/organizations.repository.js";
import * as repository from "./commerce.repository.js";

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || null;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "dev-razorpay-secret-change-me";
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || razorpayKeySecret;
if (process.env.NODE_ENV === "production" && !process.env.RAZORPAY_KEY_SECRET)
  throw new Error("RAZORPAY_KEY_SECRET is required in production");

const orderNumber = () =>
  `ZMN-O-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .toUpperCase()}`;
// Phase 1 has no live Razorpay account configured, so the provider order id is
// self-issued here in the same shape Razorpay would return. Swapping in a real
// `orders.create` API call later does not change downstream verification,
// since that already implements Razorpay's actual HMAC signature scheme.
const providerOrderId = () => `order_${randomToken(12)}`;

const toPlan = row =>
  row && {
    id: row.id,
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
    isActive: row.isActive
  };

export const listPlans = async audience => (await repository.listActivePlans(audience)).map(toPlan);

export const getPlan = async planId => {
  const row = await repository.findPlanById(planId);
  if (!row) throw new HttpError(404, "PLAN_NOT_FOUND", "Plan was not found.");
  return toPlan(row);
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
  const items = input.items.map(item => {
    const product = productById.get(item.productId);
    if (!product || !product.isActive)
      throw new HttpError(
        400,
        "INVALID_PRODUCT",
        `productId ${item.productId} is not a purchasable product.`
      );
    const unitAmountMinor = Number(product.amountMinor);
    const totalAmountMinor = unitAmountMinor * item.quantity;
    subtotalMinor += totalAmountMinor;
    return { ...item, unitAmountMinor, totalAmountMinor };
  });

  const taxMinor = 0;
  const orderId = await repository.createOrder({
    orderNumber: orderNumber(),
    userId: actorId,
    organizationId: input.organizationId,
    subtotalMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
    currency: "INR",
    items
  });
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

const toPayment = row => ({
  id: row.id,
  orderId: row.orderId,
  status: row.status,
  amountMinor: Number(row.amountMinor),
  currency: row.currency,
  paidAt: row.paidAt
});

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

  const payment = await repository.createPayment({
    orderId: order.id,
    provider: input.provider,
    providerOrderId: providerOrderId(),
    amountMinor: Number(order.totalMinor),
    currency: order.currency
  });
  if (order.status !== "PAYMENT_PENDING") await repository.setOrderStatus(order.id, "PAYMENT_PENDING");

  return {
    paymentId: payment.id,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    amountMinor: Number(payment.amountMinor),
    currency: payment.currency,
    providerPublicKey: payment.provider === "RAZORPAY" ? razorpayKeyId : null,
    checkoutPayload: {
      orderId: payment.providerOrderId,
      amount: Number(payment.amountMinor),
      currency: payment.currency,
      name: "Zameens",
      notes: { internalOrderId: order.id, internalPaymentId: payment.id },
      returnUrl: input.returnUrl || null
    }
  };
};

export const verifyPayment = async ({ actorId, input }) => {
  const payment = await repository.findPaymentOwnedByUser(input.paymentId, actorId);
  if (!payment) throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment was not found.");
  if (payment.status === "CAPTURED") return toPayment(payment);
  if (payment.providerOrderId !== input.providerOrderId)
    throw new HttpError(
      400,
      "PAYMENT_ORDER_MISMATCH",
      "providerOrderId does not match this payment."
    );

  const verified =
    payment.provider !== "RAZORPAY" ||
    safeEqualHex(
      input.signature,
      hmacSha256Hex(`${input.providerOrderId}|${input.providerPaymentId}`, razorpayKeySecret)
    );

  if (!verified) {
    await repository.failPayment({
      id: payment.id,
      providerPayload: {
        providerPaymentId: input.providerPaymentId,
        providerOrderId: input.providerOrderId,
        reason: "SIGNATURE_MISMATCH"
      }
    });
    throw new HttpError(
      400,
      "PAYMENT_SIGNATURE_INVALID",
      "Payment signature could not be verified."
    );
  }

  const captured = await repository.capturePayment({
    id: payment.id,
    providerPaymentId: input.providerPaymentId,
    providerPayload: {
      providerOrderId: input.providerOrderId,
      providerPaymentId: input.providerPaymentId,
      signature: input.signature
    }
  });
  if (!captured.ok) throw captured.error;
  await repository.setOrderStatus(payment.orderId, "PAID");
  return toPayment(captured.data);
};

export const handleWebhook = async ({ signatureHeader, rawBody, body }) => {
  const provider = "RAZORPAY";
  const expectedSignature = hmacSha256Hex(rawBody, razorpayWebhookSecret);
  if (!signatureHeader || !safeEqualHex(signatureHeader, expectedSignature))
    throw new HttpError(
      400,
      "WEBHOOK_SIGNATURE_INVALID",
      "Webhook signature could not be verified."
    );

  const eventType = body?.event || "UNKNOWN";
  const eventId = body?.id || sha256(rawBody?.length ? rawBody : JSON.stringify(body || {}));
  const inserted = await repository.insertWebhookEvent({ provider, eventId, eventType, payload: body });
  if (!inserted) return { received: true, duplicate: true };

  try {
    const paymentEntity = body?.payload?.payment?.entity;
    if (paymentEntity?.order_id) {
      const payment = await repository.findPaymentByProviderOrderId(provider, paymentEntity.order_id);
      if (payment && payment.status !== "CAPTURED") {
        if (eventType === "payment.captured") {
          const captured = await repository.capturePayment({
            id: payment.id,
            providerPaymentId: paymentEntity.id,
            providerPayload: body
          });
          if (!captured.ok) throw captured.error;
          await repository.setOrderStatus(payment.orderId, "PAID");
        } else if (eventType === "payment.failed") {
          const failed = await repository.failPayment({ id: payment.id, providerPayload: body });
          if (!failed.ok) throw failed.error;
        }
      }
    }
    await repository.markWebhookProcessed(inserted.id);
  } catch (error) {
    await repository.markWebhookProcessed(inserted.id, error.message);
    throw error;
  }

  return { received: true, duplicate: false };
};

const toServiceItem = row =>
  row && {
    id: row.id,
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

export const submitServiceReport = async ({ requestId, input }) => {
  const existing = await repository.findServiceRequestById(requestId);
  if (!existing) throw new HttpError(404, "SERVICE_REQUEST_NOT_FOUND", "Service request was not found.");
  if (!reportableStates.has(existing.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Service request cannot be marked completed from its current state."
    );
  const result = await repository.setServiceRequestReport({
    id: requestId,
    storageKey: input.storageKey,
    summary: input.summary
  });
  if (!result.ok) throw result.error;
  return toServiceRequest(result.data, { includeInternal: true });
};

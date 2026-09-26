import { HttpError } from "../../shared/http.js";
import { toField } from "../../shared/validation.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const planTypes = new Set(["FREE", "PREMIUM", "BROKER"]);
const orderStatuses = new Set([
  "CREATED",
  "PAYMENT_PENDING",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUNDED"
]);
// Phase 1 supports Razorpay only — STRIPE/OTHER have no server-side verification implemented.
const providers = new Set(["RAZORPAY"]);
const currencies = new Set(["INR"]);
const maxOrderItems = 20;
const targetTypes = new Set(["LISTING", "SERVICE_REQUEST"]);
const e164Pattern = /^\+[1-9]\d{7,14}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const serviceTypes = new Set([
  "LEGAL_REVIEW",
  "TITLE_SEARCH",
  "VALUATION",
  "LOAN_ASSISTANCE",
  "REGISTRATION"
]);
const serviceRequestStatuses = new Set([
  "REQUESTED",
  "PAYMENT_PENDING",
  "IN_PROGRESS",
  "DOCUMENTS_REQUIRED",
  "COMPLETED",
  "CANCELLED"
]);
const maxFileSizeBytes = 50 * 1024 * 1024;
// Mirrors the commerce.payments status CHECK constraint, not the narrower
// `providers` set above — that one governs what a *new* payment can be
// created with (Razorpay only, Phase 1); this covers whatever the schema
// itself allows a payment row to already carry, for admin filtering.
const paymentStatuses = new Set([
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED"
]);
const paymentProviders = new Set(["RAZORPAY", "STRIPE", "OTHER"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text)) {
    const message = `${field} must be a valid UUID.`;
    throw new HttpError(400, "INVALID_ID", message, [
      { field: toField(field), message }
    ]);
  }
  return text;
};

const optionalUuid = (value, field) =>
  value === undefined || value === null || value === ""
    ? null
    : uuid(value, field);

const optionalString = (value, max, field, detailsField = toField(field)) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max) {
    const message = `${field} must be at most ${max} characters.`;
    throw new HttpError(400, `INVALID_${field}`, message, [
      { field: detailsField, message }
    ]);
  }
  return text;
};

const requiredString = (value, min, max, field) => {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    const message = `${field} must be between ${min} and ${max} characters.`;
    throw new HttpError(400, `INVALID_${field}`, message, [
      { field: toField(field), message }
    ]);
  }
  return text;
};

const optionalEnum = (value, set, code, label) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value)
    .trim()
    .toUpperCase();
  if (!set.has(text)) {
    const message = `${code} must be ${label}.`;
    throw new HttpError(400, `INVALID_${code}`, message, [
      { field: toField(code), message }
    ]);
  }
  return text;
};

const requiredEnum = (value, set, code, label) => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!set.has(text)) {
    const message = `${code} must be ${label}.`;
    throw new HttpError(400, `INVALID_${code}`, message, [
      { field: toField(code), message }
    ]);
  }
  return text;
};

const requiredNonNegativeInteger = (value, field) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    const message = `${field} must be a whole number >= 0.`;
    throw new HttpError(400, `INVALID_${field}`, message, [
      { field: toField(field), message }
    ]);
  }
  return num;
};

const optionalPositiveInteger = (
  value,
  field,
  detailsField = toField(field)
) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    const message = `${field} must be a positive whole number.`;
    throw new HttpError(400, `INVALID_${field}`, message, [
      { field: detailsField, message }
    ]);
  }
  return num;
};

const optionalNonNegativeInteger = (
  value,
  field,
  detailsField = toField(field)
) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    const message = `${field} must be a whole number >= 0.`;
    throw new HttpError(400, `INVALID_${field}`, message, [
      { field: detailsField, message }
    ]);
  }
  return num;
};

// Basis points (1800 = 18%) — bounded to a real GST percentage (0-100%),
// unlike the general-purpose optionalNonNegativeInteger above.
const optionalGstRateBps = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 10000) {
    const message = `${field} must be a whole number between 0 and 10000 (basis points).`;
    throw new HttpError(400, `INVALID_${field}`, message, [
      { field: toField(field), message }
    ]);
  }
  return num;
};

const optionalObject = (value, field) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    const message = `${field} must be an object.`;
    throw new HttpError(400, `INVALID_${field}`, message, [
      { field: toField(field), message }
    ]);
  }
  return value;
};

// `contactUnlocks` is one entitlement whose usage period is selected by the
// plan type. Keep the retired keys out of new admin payloads so an outdated
// client cannot restore the duplicate configuration after migration 020.
const planFeatures = value => {
  const features = optionalObject(value, "FEATURES");
  if (!features) return null;
  const legacyKey = [
    "contactUnlocksLifetime",
    "contactUnlocksPerMonth"
  ].find(key => Object.hasOwn(features, key));
  if (legacyKey) {
    const message = `${legacyKey} is retired; use contactUnlocks instead.`;
    throw new HttpError(400, "INVALID_FEATURES", message, [
      { field: `features.${legacyKey}`, message }
    ]);
  }
  if (!Object.hasOwn(features, "contactUnlocks")) return features;
  return {
    ...features,
    contactUnlocks: optionalNonNegativeInteger(
      features.contactUnlocks,
      "CONTACT_UNLOCKS",
      "features.contactUnlocks"
    )
  };
};

const optionalBoolean = (value, fallback) =>
  value === undefined || value === null ? fallback : Boolean(value);

const optionalDate = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!datePattern.test(text)) {
    const message = `${field} must be a date in YYYY-MM-DD format.`;
    throw new HttpError(400, `INVALID_${field}`, message, [
      { field: toField(field), message }
    ]);
  }
  return text;
};

export const planAudience = query =>
  optionalEnum(
    query.audience,
    planTypes,
    "AUDIENCE",
    "FREE, PREMIUM, or BROKER"
  );

export const createOrder = body => {
  if (
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > maxOrderItems
  ) {
    const message = `items must contain between 1 and ${maxOrderItems} entries.`;
    throw new HttpError(400, "INVALID_ITEMS", message, [
      { field: "items", message }
    ]);
  }
  const items = body.items.map((item, index) => {
    const targetType = optionalEnum(
      item?.targetType,
      targetTypes,
      `ITEMS_${index}_TARGET_TYPE`,
      "LISTING or SERVICE_REQUEST"
    );
    const targetId = optionalUuid(item?.targetId, `items[${index}].targetId`);
    if (targetType && !targetId) {
      const message = `items[${index}].targetId is required when targetType is set.`;
      throw new HttpError(400, "TARGET_ID_REQUIRED", message, [
        { field: `items[${index}].targetId`, message }
      ]);
    }
    if (targetId && !targetType) {
      const message = `items[${index}].targetType is required when targetId is set.`;
      throw new HttpError(400, "TARGET_TYPE_REQUIRED", message, [
        { field: `items[${index}].targetType`, message }
      ]);
    }
    return {
      productId: uuid(item?.productId, `items[${index}].productId`),
      quantity:
        optionalPositiveInteger(
          item?.quantity,
          `ITEMS_${index}_QUANTITY`,
          `items[${index}].quantity`
        ) ?? 1,
      targetType,
      targetId
    };
  });

  const couponCode = optionalString(body.couponCode, 50, "COUPON_CODE");
  if (couponCode)
    throw new HttpError(
      400,
      "COUPON_NOT_SUPPORTED",
      "Coupon codes are not supported yet.",
      [{ field: "couponCode", message: "Coupon codes are not supported yet." }]
    );

  return {
    items,
    organizationId: optionalUuid(body.organizationId, "organizationId"),
    couponCode: null
  };
};

export const orderListQuery = query => ({
  status: optionalEnum(
    query.status,
    orderStatuses,
    "STATUS",
    "a valid OrderStatus"
  )
});

export const createPayment = body => ({
  provider: body?.provider
    ? requiredEnum(body.provider, providers, "PROVIDER", "RAZORPAY")
    : "RAZORPAY"
});

// Query params Razorpay appends when redirecting the customer's browser back
// to our Payment Link callback URL. There is no Authorization header on this
// request, and the handler using this must never throw into a JSON error
// response — it always redirects, even on garbage input — so unlike the rest
// of this file, this reads values defensively (a plain string-or-null cast)
// instead of throwing on anything unexpected; an invalid/oversized value
// simply fails the signature check downstream instead of blowing up here.
const safeQueryString = (value, max) => {
  if (typeof value !== "string" || !value) return null;
  return value.length > max ? null : value;
};

export const paymentCallbackQuery = query => ({
  paymentId: safeQueryString(query?.razorpay_payment_id, 255),
  paymentLinkId: safeQueryString(query?.razorpay_payment_link_id, 255),
  referenceId: safeQueryString(query?.razorpay_payment_link_reference_id, 255),
  status: safeQueryString(query?.razorpay_payment_link_status, 50),
  signature: safeQueryString(query?.razorpay_signature, 512)
});

const optionalStrictBoolean = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value)
    .trim()
    .toLowerCase();
  if (["true", "1"].includes(text)) return true;
  if (["false", "0"].includes(text)) return false;
  const message = `${field} must be true or false.`;
  throw new HttpError(400, `INVALID_${field}`, message, [
    { field: toField(field), message }
  ]);
};

export const adminPlanListQuery = query => ({
  planType: optionalEnum(
    query.planType,
    planTypes,
    "PLAN_TYPE",
    "FREE, PREMIUM, or BROKER"
  ),
  isActive: optionalStrictBoolean(query.isActive, "IS_ACTIVE"),
  search: optionalString(query.search, 200, "SEARCH")
});

export const createPlan = body => ({
  code: requiredString(body.code, 2, 100, "CODE"),
  name: requiredString(body.name, 2, 255, "NAME"),
  planType: requiredEnum(
    body.planType,
    planTypes,
    "PLAN_TYPE",
    "FREE, PREMIUM, or BROKER"
  ),
  description: optionalString(body.description, 2000, "DESCRIPTION"),
  amountMinor: requiredNonNegativeInteger(body.amountMinor, "AMOUNT_MINOR"),
  currency: body.currency
    ? requiredEnum(body.currency, currencies, "CURRENCY", "INR")
    : "INR",
  durationDays: optionalPositiveInteger(body.durationDays, "DURATION_DAYS"),
  listingLimit: optionalNonNegativeInteger(body.listingLimit, "LISTING_LIMIT"),
  featuredDays: optionalNonNegativeInteger(body.featuredDays, "FEATURED_DAYS"),
  verificationIncluded: optionalBoolean(body.verificationIncluded, false),
  features: planFeatures(body.features) || {},
  isActive: optionalBoolean(body.isActive, true),
  aiMonthlyQuota: optionalNonNegativeInteger(
    body.aiMonthlyQuota,
    "AI_MONTHLY_QUOTA"
  ),
  gstRateBps: optionalGstRateBps(body.gstRateBps, "GST_RATE_BPS") ?? 1800,
  hsnSacCode: optionalString(body.hsnSacCode, 20, "HSN_SAC_CODE")
});

export const updatePlan = body => {
  const changes = {};
  if (Object.hasOwn(body, "code"))
    changes.code = requiredString(body.code, 2, 100, "CODE");
  if (Object.hasOwn(body, "name"))
    changes.name = requiredString(body.name, 2, 255, "NAME");
  if (Object.hasOwn(body, "planType"))
    changes.planType = requiredEnum(
      body.planType,
      planTypes,
      "PLAN_TYPE",
      "FREE, PREMIUM, or BROKER"
    );
  if (Object.hasOwn(body, "description"))
    changes.description = optionalString(body.description, 2000, "DESCRIPTION");
  if (Object.hasOwn(body, "amountMinor"))
    changes.amountMinor = requiredNonNegativeInteger(
      body.amountMinor,
      "AMOUNT_MINOR"
    );
  if (Object.hasOwn(body, "currency"))
    changes.currency = requiredEnum(
      body.currency,
      currencies,
      "CURRENCY",
      "INR"
    );
  if (Object.hasOwn(body, "durationDays"))
    changes.durationDays = optionalPositiveInteger(
      body.durationDays,
      "DURATION_DAYS"
    );
  if (Object.hasOwn(body, "listingLimit"))
    changes.listingLimit = optionalNonNegativeInteger(
      body.listingLimit,
      "LISTING_LIMIT"
    );
  if (Object.hasOwn(body, "featuredDays"))
    changes.featuredDays = optionalNonNegativeInteger(
      body.featuredDays,
      "FEATURED_DAYS"
    );
  if (Object.hasOwn(body, "verificationIncluded"))
    changes.verificationIncluded = Boolean(body.verificationIncluded);
  if (Object.hasOwn(body, "features"))
    changes.features = planFeatures(body.features) || {};
  if (Object.hasOwn(body, "isActive"))
    changes.isActive = Boolean(body.isActive);
  if (Object.hasOwn(body, "aiMonthlyQuota"))
    changes.aiMonthlyQuota = optionalNonNegativeInteger(
      body.aiMonthlyQuota,
      "AI_MONTHLY_QUOTA"
    );
  if (Object.hasOwn(body, "gstRateBps"))
    changes.gstRateBps = optionalGstRateBps(body.gstRateBps, "GST_RATE_BPS");
  if (Object.hasOwn(body, "hsnSacCode"))
    changes.hsnSacCode = optionalString(body.hsnSacCode, 20, "HSN_SAC_CODE");
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};

const optionalPhone = value => {
  if (value === undefined || value === null || value === "") return null;
  const phone = String(value).trim();
  if (!e164Pattern.test(phone)) {
    const message = "contactPhone must be a valid E.164 number.";
    throw new HttpError(400, "INVALID_CONTACT_PHONE", message, [
      { field: "contactPhone", message }
    ]);
  }
  return phone;
};

const optionalEmail = value => {
  if (value === undefined || value === null || value === "") return null;
  const email = String(value)
    .trim()
    .toLowerCase();
  if (!emailPattern.test(email)) {
    const message = "contactEmail must be a valid email address.";
    throw new HttpError(400, "INVALID_CONTACT_EMAIL", message, [
      { field: "contactEmail", message }
    ]);
  }
  return email;
};

const fileInput = body => {
  const fileName = requiredString(body.fileName, 1, 255, "FILE_NAME");
  const mimeType = requiredString(
    body.mimeType,
    1,
    255,
    "MIME_TYPE"
  ).toLowerCase();
  const fileSizeBytes = Number(body.fileSizeBytes);
  if (
    !Number.isInteger(fileSizeBytes) ||
    fileSizeBytes <= 0 ||
    fileSizeBytes > maxFileSizeBytes
  ) {
    const message = `fileSizeBytes must be a positive whole number up to ${maxFileSizeBytes} bytes.`;
    throw new HttpError(400, "INVALID_FILE_SIZE_BYTES", message, [
      { field: "fileSizeBytes", message }
    ]);
  }
  return { fileName, mimeType, fileSizeBytes };
};

export const serviceListQuery = query => ({
  serviceType: optionalEnum(
    query.type,
    serviceTypes,
    "TYPE",
    "LEGAL_REVIEW, TITLE_SEARCH, VALUATION, LOAN_ASSISTANCE, or REGISTRATION"
  )
});

export const createServiceRequest = body => ({
  serviceId: uuid(body.serviceId, "serviceId"),
  propertyId: optionalUuid(body.propertyId, "propertyId"),
  listingId: optionalUuid(body.listingId, "listingId"),
  customerNotes: optionalString(body.customerNotes, 2000, "CUSTOMER_NOTES"),
  contactPhone: optionalPhone(body.contactPhone),
  contactEmail: optionalEmail(body.contactEmail)
});

export const serviceRequestListQuery = query => ({
  status: optionalEnum(
    query.status,
    serviceRequestStatuses,
    "STATUS",
    "a valid ServiceRequestStatus"
  )
});

export const adminPaymentListQuery = query => {
  const fromDate = optionalDate(query.fromDate, "FROM_DATE");
  const toDate = optionalDate(query.toDate, "TO_DATE");
  if (fromDate && toDate && fromDate > toDate) {
    const message = "fromDate must be on or before toDate.";
    throw new HttpError(400, "INVALID_DATE_RANGE", message, [
      { field: "fromDate", message }
    ]);
  }
  return {
    status: optionalEnum(
      query.status,
      paymentStatuses,
      "STATUS",
      "a valid PaymentStatus"
    ),
    provider: optionalEnum(
      query.provider,
      paymentProviders,
      "PROVIDER",
      "RAZORPAY, STRIPE, or OTHER"
    ),
    orderId: optionalUuid(query.orderId, "orderId"),
    userId: optionalUuid(query.userId, "userId"),
    search: optionalString(query.search, 200, "SEARCH"),
    fromDate,
    toDate
  };
};

export const adminServiceRequestListQuery = query => ({
  status: optionalEnum(
    query.status,
    serviceRequestStatuses,
    "STATUS",
    "a valid ServiceRequestStatus"
  ),
  serviceType: optionalEnum(
    query.serviceType,
    serviceTypes,
    "SERVICE_TYPE",
    "LEGAL_REVIEW, TITLE_SEARCH, VALUATION, LOAN_ASSISTANCE, or REGISTRATION"
  ),
  search: optionalString(query.search, 200, "SEARCH")
});

export const fileUploadInit = body => fileInput(body);

export const serviceFileComplete = body => ({
  ...fileInput(body),
  storageKey: requiredString(body.storageKey, 1, 2048, "STORAGE_KEY")
});

export const updateServiceRequestStatus = body => {
  const result = {
    status: requiredEnum(
      body.status,
      serviceRequestStatuses,
      "STATUS",
      "a valid ServiceRequestStatus"
    )
  };
  if (Object.hasOwn(body, "internalNote"))
    result.internalNote = optionalString(
      body.internalNote,
      2000,
      "INTERNAL_NOTE"
    );
  return result;
};

export const serviceReportInput = body => ({
  storageKey: requiredString(body.storageKey, 1, 2048, "STORAGE_KEY"),
  summary: optionalString(body.summary, 3000, "SUMMARY")
});

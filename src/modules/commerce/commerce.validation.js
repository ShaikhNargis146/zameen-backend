import { HttpError } from "../../shared/http.js";

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
const providers = new Set(["RAZORPAY", "STRIPE", "OTHER"]);
const currencies = new Set(["INR"]);
const maxOrderItems = 20;
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

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};

const optionalUuid = (value, field) =>
  value === undefined || value === null || value === "" ? null : uuid(value, field);

const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max)
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be at most ${max} characters.`
    );
  return text;
};

const requiredString = (value, min, max, field) => {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max)
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be between ${min} and ${max} characters.`
    );
  return text;
};

const optionalEnum = (value, set, code, label) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toUpperCase();
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
  return text;
};

const requiredEnum = (value, set, code, label) => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
  return text;
};

const requiredNonNegativeInteger = (value, field) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a whole number >= 0.`);
  return num;
};

const optionalPositiveInteger = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a positive whole number.`);
  return num;
};

const optionalNonNegativeInteger = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a whole number >= 0.`);
  return num;
};

const optionalObject = (value, field) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, `INVALID_${field}`, `${field} must be an object.`);
  return value;
};

const optionalBoolean = (value, fallback) =>
  value === undefined || value === null ? fallback : Boolean(value);

const optionalUrl = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  try {
    // eslint-disable-next-line no-new
    new URL(text);
  } catch {
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a valid URL.`);
  }
  return text;
};

export const planAudience = query =>
  optionalEnum(query.audience, planTypes, "AUDIENCE", "FREE, PREMIUM, or BROKER");

export const createOrder = body => {
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > maxOrderItems)
    throw new HttpError(
      400,
      "INVALID_ITEMS",
      `items must contain between 1 and ${maxOrderItems} entries.`
    );
  const items = body.items.map((item, index) => ({
    productId: uuid(item?.productId, `items[${index}].productId`),
    quantity: optionalPositiveInteger(item?.quantity, `ITEMS_${index}_QUANTITY`) ?? 1,
    targetType: optionalString(item?.targetType, 50, `ITEMS_${index}_TARGET_TYPE`),
    targetId: optionalUuid(item?.targetId, `items[${index}].targetId`)
  }));

  const couponCode = optionalString(body.couponCode, 50, "COUPON_CODE");
  if (couponCode)
    throw new HttpError(400, "COUPON_NOT_SUPPORTED", "Coupon codes are not supported yet.");

  return {
    items,
    organizationId: optionalUuid(body.organizationId, "organizationId"),
    couponCode: null
  };
};

export const orderListQuery = query => ({
  status: optionalEnum(query.status, orderStatuses, "STATUS", "a valid OrderStatus")
});

export const createPayment = body => ({
  provider: body?.provider
    ? requiredEnum(body.provider, providers, "PROVIDER", "RAZORPAY, STRIPE, or OTHER")
    : "RAZORPAY",
  returnUrl: optionalUrl(body?.returnUrl, "RETURN_URL")
});

export const verifyPayment = body => ({
  paymentId: uuid(body.paymentId, "paymentId"),
  providerPaymentId: requiredString(body.providerPaymentId, 1, 255, "PROVIDER_PAYMENT_ID"),
  providerOrderId: requiredString(body.providerOrderId, 1, 255, "PROVIDER_ORDER_ID"),
  signature: requiredString(body.signature, 1, 512, "SIGNATURE")
});

export const createPlan = body => ({
  code: requiredString(body.code, 2, 100, "CODE"),
  name: requiredString(body.name, 2, 255, "NAME"),
  planType: requiredEnum(body.planType, planTypes, "PLAN_TYPE", "FREE, PREMIUM, or BROKER"),
  description: optionalString(body.description, 2000, "DESCRIPTION"),
  amountMinor: requiredNonNegativeInteger(body.amountMinor, "AMOUNT_MINOR"),
  currency: body.currency ? requiredEnum(body.currency, currencies, "CURRENCY", "INR") : "INR",
  durationDays: optionalPositiveInteger(body.durationDays, "DURATION_DAYS"),
  listingLimit: optionalNonNegativeInteger(body.listingLimit, "LISTING_LIMIT"),
  featuredDays: optionalNonNegativeInteger(body.featuredDays, "FEATURED_DAYS"),
  verificationIncluded: optionalBoolean(body.verificationIncluded, false),
  features: optionalObject(body.features, "FEATURES") || {},
  isActive: optionalBoolean(body.isActive, true)
});

export const updatePlan = body => {
  const changes = {};
  if (Object.hasOwn(body, "code")) changes.code = requiredString(body.code, 2, 100, "CODE");
  if (Object.hasOwn(body, "name")) changes.name = requiredString(body.name, 2, 255, "NAME");
  if (Object.hasOwn(body, "planType"))
    changes.planType = requiredEnum(body.planType, planTypes, "PLAN_TYPE", "FREE, PREMIUM, or BROKER");
  if (Object.hasOwn(body, "description"))
    changes.description = optionalString(body.description, 2000, "DESCRIPTION");
  if (Object.hasOwn(body, "amountMinor"))
    changes.amountMinor = requiredNonNegativeInteger(body.amountMinor, "AMOUNT_MINOR");
  if (Object.hasOwn(body, "currency"))
    changes.currency = requiredEnum(body.currency, currencies, "CURRENCY", "INR");
  if (Object.hasOwn(body, "durationDays"))
    changes.durationDays = optionalPositiveInteger(body.durationDays, "DURATION_DAYS");
  if (Object.hasOwn(body, "listingLimit"))
    changes.listingLimit = optionalNonNegativeInteger(body.listingLimit, "LISTING_LIMIT");
  if (Object.hasOwn(body, "featuredDays"))
    changes.featuredDays = optionalNonNegativeInteger(body.featuredDays, "FEATURED_DAYS");
  if (Object.hasOwn(body, "verificationIncluded"))
    changes.verificationIncluded = Boolean(body.verificationIncluded);
  if (Object.hasOwn(body, "features"))
    changes.features = optionalObject(body.features, "FEATURES") || {};
  if (Object.hasOwn(body, "isActive")) changes.isActive = Boolean(body.isActive);
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};

const optionalPhone = value => {
  if (value === undefined || value === null || value === "") return null;
  const phone = String(value).trim();
  if (!e164Pattern.test(phone))
    throw new HttpError(400, "INVALID_CONTACT_PHONE", "contactPhone must be a valid E.164 number.");
  return phone;
};

const optionalEmail = value => {
  if (value === undefined || value === null || value === "") return null;
  const email = String(value).trim().toLowerCase();
  if (!emailPattern.test(email))
    throw new HttpError(400, "INVALID_CONTACT_EMAIL", "contactEmail must be a valid email address.");
  return email;
};

const fileInput = body => {
  const fileName = requiredString(body.fileName, 1, 255, "FILE_NAME");
  const mimeType = requiredString(body.mimeType, 1, 255, "MIME_TYPE").toLowerCase();
  const fileSizeBytes = Number(body.fileSizeBytes);
  if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > maxFileSizeBytes)
    throw new HttpError(
      400,
      "INVALID_FILE_SIZE_BYTES",
      `fileSizeBytes must be a positive whole number up to ${maxFileSizeBytes} bytes.`
    );
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
  status: optionalEnum(query.status, serviceRequestStatuses, "STATUS", "a valid ServiceRequestStatus")
});

export const adminServiceRequestListQuery = query => ({
  status: optionalEnum(query.status, serviceRequestStatuses, "STATUS", "a valid ServiceRequestStatus"),
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
    status: requiredEnum(body.status, serviceRequestStatuses, "STATUS", "a valid ServiceRequestStatus")
  };
  if (Object.hasOwn(body, "internalNote"))
    result.internalNote = optionalString(body.internalNote, 2000, "INTERNAL_NOTE");
  return result;
};

export const serviceReportInput = body => ({
  storageKey: requiredString(body.storageKey, 1, 2048, "STORAGE_KEY"),
  summary: optionalString(body.summary, 3000, "SUMMARY")
});

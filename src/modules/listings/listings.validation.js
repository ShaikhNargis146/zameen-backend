import { HttpError } from "../../shared/http.js";

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const listingStatuses = new Set([
  "INACTIVE",
  "PUBLISHED",
  "PAUSED",
  "EXPIRED",
  "SOLD",
  "WITHDRAWN",
  "SUSPENDED"
]);
export const create = body => {
  const title = String(body.title || "").trim();
  if (!title) throw new HttpError(400, "TITLE_REQUIRED", "title is required.");
  return {
    organizationId: body.organizationId || body.sellerOrganizationId || null,
    transactionType: body.transactionType || "SALE",
    title,
    description: body.description || null,
    canonicalLanguage: body.canonicalLanguage || "en",
    priceAmountMinor: body.priceAmountMinor ?? null,
    currency: body.currency || "INR",
    isNegotiable: Boolean(body.isNegotiable)
  };
};
export const update = body => {
  const fields = {
    title: "title",
    description: "description",
    transactionType: "transaction_type",
    canonicalLanguage: "canonical_language",
    priceAmountMinor: "price_amount_minor",
    currency: "currency",
    isNegotiable: "is_negotiable"
  };
  const changes = {};
  for (const [input, column] of Object.entries(fields))
    if (has(body, input)) changes[column] = body[input];
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};
export const sellerList = query => {
  const status = query.status ? String(query.status).toUpperCase() : null;
  if (status && !listingStatuses.has(status))
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid listing status.");
  return {
    status,
    limit: Math.min(Math.max(Number(query.limit || 20), 1), 100),
    offset: Math.max(Number(query.offset || 0), 0)
  };
};
export const reviewStatus = query =>
  query.reviewStatus ? String(query.reviewStatus).toUpperCase() : null;
export const reason = body => {
  const value = String(body.reason || "").trim();
  if (!value)
    throw new HttpError(
      400,
      "REJECTION_REASON_REQUIRED",
      "reason is required."
    );
  return value;
};

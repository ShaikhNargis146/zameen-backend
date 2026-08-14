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
const transactionTypes = new Set(["SALE", "LEASE"]);
const languages = new Set(["en", "hi", "mr", "gu", "pa", "te", "ta"]);
const reviewStatuses = new Set(["DRAFT", "PENDING", "APPROVED", "REJECTED"]);
const text = (value, field, min, max, required = false) => {
  const result = String(value || "").trim();
  if (!result && !required) return null;
  if (result.length < min || result.length > max)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must contain ${min} to ${max} characters.`
    );
  return result;
};
const transactionType = value => {
  const result = String(value || "SALE")
    .trim()
    .toUpperCase();
  if (!transactionTypes.has(result))
    throw new HttpError(400, "VALIDATION_ERROR", "transactionType is invalid.");
  return result;
};
const language = value => {
  const result = String(value || "en")
    .trim()
    .toLowerCase();
  if (!languages.has(result))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "canonicalLanguage is unsupported."
    );
  return result;
};
const price = value => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "priceAmountMinor must be a positive integer."
    );
  return result;
};
const boolean = (value, field) => {
  if (typeof value === "boolean") return value;
  if (["true", "1"].includes(String(value).toLowerCase())) return true;
  if (["false", "0"].includes(String(value).toLowerCase())) return false;
  throw new HttpError(400, "VALIDATION_ERROR", `${field} must be a boolean.`);
};
export const create = body => {
  return {
    organizationId: body.organizationId || body.sellerOrganizationId || null,
    transactionType: transactionType(body.transactionType),
    title: text(body.title, "title", 10, 255, true),
    description: text(body.description, "description", 20, 5000, true),
    canonicalLanguage: language(body.canonicalLanguage),
    priceAmountMinor: price(body.priceAmountMinor),
    currency:
      String(body.currency || "INR").toUpperCase() === "INR"
        ? "INR"
        : (() => {
            throw new HttpError(
              400,
              "VALIDATION_ERROR",
              "currency must be INR in this release."
            );
          })(),
    isNegotiable:
      body.isNegotiable === undefined
        ? false
        : boolean(body.isNegotiable, "isNegotiable")
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
  for (const [input, column] of Object.entries(fields)) {
    if (!has(body, input)) continue;
    if (input === "title")
      changes[column] = text(body[input], "title", 10, 255, true);
    else if (input === "description")
      changes[column] = text(body[input], "description", 20, 5000, true);
    else if (input === "transactionType")
      changes[column] = transactionType(body[input]);
    else if (input === "canonicalLanguage")
      changes[column] = language(body[input]);
    else if (input === "priceAmountMinor") changes[column] = price(body[input]);
    else if (input === "currency") {
      if (String(body[input]).toUpperCase() !== "INR")
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "currency must be INR in this release."
        );
      changes[column] = "INR";
    } else changes[column] = boolean(body[input], "isNegotiable");
  }
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};
export const sellerList = query => {
  const status = query.status ? String(query.status).toUpperCase() : null;
  const reviewStatus = query.reviewStatus
    ? String(query.reviewStatus).toUpperCase()
    : null;
  if (status && !listingStatuses.has(status))
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid listing status.");
  if (reviewStatus && !reviewStatuses.has(reviewStatus))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Invalid listing review status."
    );
  const page = Math.min(Math.max(Number(query.page || 1), 1), 10000);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  return {
    status,
    reviewStatus,
    search: query.search
      ? String(query.search)
          .trim()
          .slice(0, 200)
      : null,
    page,
    limit,
    offset: (page - 1) * limit
  };
};
export const reviewStatus = query =>
  query.reviewStatus
    ? reviewStatuses.has(String(query.reviewStatus).toUpperCase())
      ? String(query.reviewStatus).toUpperCase()
      : (() => {
          throw new HttpError(
            400,
            "VALIDATION_ERROR",
            "Invalid listing review status."
          );
        })()
    : null;
export const reason = body => {
  return text(body.reason, "reason", 3, 1000, true);
};
export const optionalReason = body =>
  body.reason === undefined ? null : text(body.reason, "reason", 3, 1000, true);
export const approval = body => {
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (
    expiresAt &&
    (!Number.isFinite(expiresAt.valueOf()) || expiresAt <= new Date())
  )
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "expiresAt must be a future ISO date."
    );
  return {
    expiresAt,
    note:
      body.note === undefined ? null : text(body.note, "note", 1, 1000, true)
  };
};
export const adminList = query => ({
  reviewStatus: reviewStatus(query),
  status: query.status
    ? (() => {
        const value = String(query.status).toUpperCase();
        if (!listingStatuses.has(value))
          throw new HttpError(
            400,
            "VALIDATION_ERROR",
            "Invalid listing status."
          );
        return value;
      })()
    : null,
  search: query.search
    ? String(query.search)
        .trim()
        .slice(0, 200)
    : null,
  page: Math.min(Math.max(Number(query.page || 1), 1), 10000),
  limit: Math.min(Math.max(Number(query.limit || 20), 1), 100)
});

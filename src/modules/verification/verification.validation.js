import { HttpError } from "../../shared/http.js";

const checkTypes = new Set([
  "LOCATION",
  "LAND_DETAILS",
  "PARCEL_IDENTITY",
  "DOCUMENTS",
  "SITE_VISIT"
]);
const statuses = new Set(["PENDING", "VERIFIED", "REJECTED", "PARTIAL"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const optionalText = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must be at most ${max} characters.`
    );
  return text;
};
const enumValue = (value, values, field, required = false) => {
  const item = String(value || "")
    .trim()
    .toUpperCase();
  if (!item && !required) return null;
  if (!values.has(item))
    throw new HttpError(400, "VALIDATION_ERROR", `${field} is invalid.`);
  return item;
};

export const listQuery = query => ({
  status: enumValue(query.status, statuses, "status"),
  checkType: enumValue(query.checkType, checkTypes, "checkType"),
  search: optionalText(query.search, 200, "search"),
  page: Math.min(Math.max(Number(query.page || 1), 1), 10000),
  limit: Math.min(Math.max(Number(query.limit || 20), 1), 100)
});
export const id = value => {
  const text = String(value || "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(
      400,
      "INVALID_ID",
      "verificationId must be a valid UUID."
    );
  return text;
};
export const update = body => ({
  checkType: enumValue(body.checkType, checkTypes, "checkType", true),
  status: enumValue(body.status, statuses, "status", true),
  publicNote: optionalText(body.publicNote, 500, "publicNote"),
  internalNote: optionalText(body.internalNote, 1000, "internalNote")
});

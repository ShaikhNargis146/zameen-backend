import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enquiryTypes = new Set([
  "CONTACT",
  "CALLBACK",
  "DETAILS",
  "DOCUMENT_REQUEST",
  "GENERAL"
]);
const enquiryStatuses = new Set([
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "SITE_VISIT",
  "CLOSED",
  "LOST"
]);
const contactChannels = new Set(["PHONE", "WHATSAPP", "EMAIL"]);
const toField = code =>
  /^[A-Z0-9_]+$/.test(code) ? code.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()) : code;

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text)) {
    const message = `${field} must be a valid UUID.`;
    throw new HttpError(400, "INVALID_ID", message, [{ field: toField(field), message }]);
  }
  return text;
};

const optionalUuid = (value, field) =>
  value === undefined || value === null || value === "" ? null : uuid(value, field);

const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max) {
    const message = `${field} must be at most ${max} characters.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return text;
};

const requiredString = (value, min, max, field) => {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    const message = `${field} must be between ${min} and ${max} characters.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return text;
};

const optionalEnum = (value, set, code, label) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toUpperCase();
  if (!set.has(text)) {
    const message = `${code} must be ${label}.`;
    throw new HttpError(400, `INVALID_${code}`, message, [{ field: toField(code), message }]);
  }
  return text;
};

const requiredEnum = (value, set, code, label) => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!set.has(text)) {
    const message = `${code} must be ${label}.`;
    throw new HttpError(400, `INVALID_${code}`, message, [{ field: toField(code), message }]);
  }
  return text;
};

export const createEnquiry = body => ({
  enquiryType: requiredEnum(
    body.enquiryType,
    enquiryTypes,
    "ENQUIRY_TYPE",
    "CONTACT, CALLBACK, DETAILS, DOCUMENT_REQUEST, or GENERAL"
  ),
  message: optionalString(body.message, 1000, "MESSAGE"),
  // Accepted for contract parity; marketplace.enquiries has no column to persist it.
  preferredContactChannel: optionalEnum(
    body.preferredContactChannel,
    contactChannels,
    "PREFERRED_CONTACT_CHANNEL",
    "PHONE, WHATSAPP, or EMAIL"
  )
});

export const enquiryListQuery = query => ({
  status: optionalEnum(query.status, enquiryStatuses, "STATUS", "a valid EnquiryStatus"),
  listingId: optionalUuid(query.listingId, "listingId")
});

export const sellerEnquiryQuery = query => ({
  ...enquiryListQuery(query),
  search: optionalString(query.search, 200, "SEARCH")
});

export const updateEnquiryStatus = body => ({
  status: requiredEnum(body.status, enquiryStatuses, "STATUS", "a valid EnquiryStatus")
});

export const createEnquiryNote = body => ({
  note: requiredString(body.note, 1, 2000, "NOTE")
});

export const contactRevealInput = body => ({
  preferredChannel: optionalEnum(
    body?.preferredChannel,
    contactChannels,
    "PREFERRED_CHANNEL",
    "PHONE, WHATSAPP, or EMAIL"
  )
});

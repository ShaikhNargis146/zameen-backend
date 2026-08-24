import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const opportunityStatuses = new Set(["DRAFT", "PUBLISHED", "CLOSED"]);
const e164Pattern = /^\+[1-9]\d{7,14}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};
const optionalUuid = (value, field) =>
  value === undefined || value === null || value === "" ? null : uuid(value, field);

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
const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be at most ${max} characters.`);
  return text;
};

const optionalNonNegativeInteger = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a whole number >= 0.`);
  return num;
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

const statusEnum = value => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!opportunityStatuses.has(text))
    throw new HttpError(400, "INVALID_STATUS", "status must be DRAFT, PUBLISHED, or CLOSED.");
  return text;
};

export const createOpportunity = body => ({
  title: requiredString(body.title, 5, 500, "TITLE"),
  locationId: optionalUuid(body.locationId, "locationId"),
  propertyId: optionalUuid(body.propertyId, "propertyId"),
  investmentType: requiredString(body.investmentType, 1, 50, "INVESTMENT_TYPE"),
  minimumInvestmentMinor: optionalNonNegativeInteger(body.minimumInvestmentMinor, "MINIMUM_INVESTMENT_MINOR"),
  description: requiredString(body.description, 20, 10000, "DESCRIPTION")
});

export const updateOpportunity = body => {
  const changes = {};
  if (has(body, "title")) changes.title = requiredString(body.title, 5, 500, "TITLE");
  if (has(body, "locationId")) changes.location_id = optionalUuid(body.locationId, "locationId");
  if (has(body, "propertyId")) changes.property_id = optionalUuid(body.propertyId, "propertyId");
  if (has(body, "investmentType"))
    changes.investment_type = requiredString(body.investmentType, 1, 50, "INVESTMENT_TYPE");
  if (has(body, "minimumInvestmentMinor"))
    changes.minimum_investment_minor = optionalNonNegativeInteger(
      body.minimumInvestmentMinor,
      "MINIMUM_INVESTMENT_MINOR"
    );
  if (has(body, "description")) changes.description = requiredString(body.description, 20, 10000, "DESCRIPTION");
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};

export const opportunityListQuery = (query, { isAdmin }) => ({
  locationId: optionalUuid(query.locationId, "locationId"),
  investmentType: optionalString(query.investmentType, 50, "INVESTMENT_TYPE"),
  statuses: isAdmin ? (query.status ? [statusEnum(query.status)] : null) : ["PUBLISHED"]
});

export const interestInput = body => ({
  message: optionalString(body.message, 2000, "MESSAGE"),
  contactPhone: optionalPhone(body.contactPhone),
  contactEmail: optionalEmail(body.contactEmail),
  organizationId: optionalUuid(body.organizationId, "organizationId")
});

export const optionalActionReason = body => ({
  reason:
    body?.reason === undefined || body?.reason === null || body?.reason === ""
      ? null
      : requiredString(body.reason, 3, 1000, "REASON")
});

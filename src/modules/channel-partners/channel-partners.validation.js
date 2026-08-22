import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const partnerStatuses = new Set(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]);
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

const optionalEnum = (value, set, code, label) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toUpperCase();
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
  return text;
};

const optionalExperienceYears = value => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 80)
    throw new HttpError(
      400,
      "INVALID_EXPERIENCE_YEARS",
      "experienceYears must be a whole number between 0 and 80."
    );
  return num;
};

const uuidArray = (value, field, { min = 0 } = {}) => {
  if (!Array.isArray(value))
    throw new HttpError(400, `INVALID_${field.toUpperCase()}`, `${field} must be an array of UUIDs.`);
  const ids = [...new Set(value.map((entry, index) => uuid(entry, `${field}[${index}]`)))];
  if (ids.length < min)
    throw new HttpError(
      400,
      `INVALID_${field.toUpperCase()}`,
      `${field} must contain at least ${min} location${min === 1 ? "" : "s"}.`
    );
  return ids;
};

export const channelPartnerApply = body => ({
  organizationId: optionalUuid(body.organizationId, "organizationId"),
  reraNumber: optionalString(body.reraNumber, 100, "RERA_NUMBER"),
  experienceYears: optionalExperienceYears(body.experienceYears),
  about: optionalString(body.about, 2000, "ABOUT"),
  locationIds: uuidArray(body.locationIds, "locationIds", { min: 1 })
});

export const updateChannelPartner = body => {
  const changes = {};
  if (has(body, "reraNumber")) changes.rera_number = optionalString(body.reraNumber, 100, "RERA_NUMBER");
  if (has(body, "experienceYears")) changes.experience_years = optionalExperienceYears(body.experienceYears);
  if (has(body, "about")) changes.about = optionalString(body.about, 2000, "ABOUT");

  const locationsProvided = has(body, "locationIds");
  const locationIds = locationsProvided
    ? body.locationIds === null
      ? []
      : uuidArray(body.locationIds, "locationIds", { min: 0 })
    : undefined;

  if (!Object.keys(changes).length && locationIds === undefined)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return locationIds === undefined ? changes : { ...changes, locationIds };
};

export const partnerListQuery = query => ({
  status: optionalEnum(query.status, partnerStatuses, "STATUS", "PENDING, APPROVED, REJECTED, or SUSPENDED"),
  locationId: optionalUuid(query.locationId, "locationId"),
  search: optionalString(query.search, 200, "SEARCH")
});

export const adminPartnerAction = body => ({
  note: optionalString(body?.note, 1000, "NOTE")
});

export const actionReason = body => ({
  reason: requiredString(body?.reason, 3, 1000, "REASON")
});

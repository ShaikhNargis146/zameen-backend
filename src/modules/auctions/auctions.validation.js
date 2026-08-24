import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auctionStatuses = new Set(["UPCOMING", "CLOSED", "CANCELLED"]);
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

const requiredUrl = (value, field) => {
  const text = String(value ?? "").trim();
  try {
    // eslint-disable-next-line no-new
    new URL(text);
  } catch {
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a valid URL.`);
  }
  return text;
};

const requiredDateTime = (value, field) => {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.valueOf()))
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a valid date/time.`);
  return date;
};
const optionalDate = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()))
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a valid date.`);
  return date;
};

const requiredEnum = (value, set, code, label) => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
  return text;
};
const optionalEnum = (value, set, code, label) => {
  if (value === undefined || value === null || value === "") return null;
  return requiredEnum(value, set, code, label);
};

export const createAuction = body => ({
  title: requiredString(body.title, 5, 500, "TITLE"),
  institutionName: requiredString(body.institutionName, 2, 255, "INSTITUTION_NAME"),
  locationId: optionalUuid(body.locationId, "locationId"),
  reservePriceMinor: optionalNonNegativeInteger(body.reservePriceMinor, "RESERVE_PRICE_MINOR"),
  emdAmountMinor: optionalNonNegativeInteger(body.emdAmountMinor, "EMD_AMOUNT_MINOR"),
  auctionAt: requiredDateTime(body.auctionAt, "AUCTION_AT"),
  officialUrl: requiredUrl(body.officialUrl, "OFFICIAL_URL"),
  description: optionalString(body.description, 5000, "DESCRIPTION"),
  status: body.status
    ? requiredEnum(body.status, auctionStatuses, "STATUS", "UPCOMING, CLOSED, or CANCELLED")
    : "UPCOMING"
});

export const updateAuction = body => {
  const changes = {};
  if (has(body, "title")) changes.title = requiredString(body.title, 5, 500, "TITLE");
  if (has(body, "institutionName"))
    changes.institution_name = requiredString(body.institutionName, 2, 255, "INSTITUTION_NAME");
  if (has(body, "locationId")) changes.location_id = optionalUuid(body.locationId, "locationId");
  if (has(body, "reservePriceMinor"))
    changes.reserve_price_minor = optionalNonNegativeInteger(body.reservePriceMinor, "RESERVE_PRICE_MINOR");
  if (has(body, "emdAmountMinor"))
    changes.emd_amount_minor = optionalNonNegativeInteger(body.emdAmountMinor, "EMD_AMOUNT_MINOR");
  if (has(body, "auctionAt")) changes.auction_at = requiredDateTime(body.auctionAt, "AUCTION_AT");
  if (has(body, "officialUrl")) changes.official_url = requiredUrl(body.officialUrl, "OFFICIAL_URL");
  if (has(body, "description")) changes.description = optionalString(body.description, 5000, "DESCRIPTION");
  if (has(body, "status"))
    changes.status = requiredEnum(body.status, auctionStatuses, "STATUS", "UPCOMING, CLOSED, or CANCELLED");
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};

export const auctionListQuery = query => {
  const fromDate = optionalDate(query.fromDate, "FROM_DATE");
  const toDate = optionalDate(query.toDate, "TO_DATE");
  if (fromDate && toDate && toDate < fromDate)
    throw new HttpError(400, "INVALID_TO_DATE", "toDate must be on or after fromDate.");
  return {
    locationId: optionalUuid(query.locationId, "locationId"),
    status: optionalEnum(query.status, auctionStatuses, "STATUS", "UPCOMING, CLOSED, or CANCELLED"),
    fromDate,
    toDate
  };
};

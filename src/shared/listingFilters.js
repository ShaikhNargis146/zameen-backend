import { HttpError } from "./http.js";

const transactionTypes = new Set(["SALE", "LEASE"]);
const listingStatuses = new Set([
  "INACTIVE",
  "PUBLISHED",
  "PAUSED",
  "EXPIRED",
  "SOLD",
  "WITHDRAWN",
  "SUSPENDED"
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trimmed = value => String(value ?? "").trim();

const optionalUuid = (value, field) => {
  const text = trimmed(value);
  if (!text) return null;
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};

const optionalEnum = (value, set, code, label) => {
  const text = trimmed(value).toUpperCase();
  if (!text) return null;
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
  return text;
};

const optionalPriceMinor = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0)
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be a non-negative number.`
    );
  return Math.trunc(num);
};

/**
 * Query params shared by list endpoints that surface listing cards
 * (favorites, recently-viewed), filtering on the underlying listing.
 */
export const listingFilterQuery = query => ({
  search: trimmed(query.search).slice(0, 255) || null,
  transactionType: optionalEnum(
    query.transactionType,
    transactionTypes,
    "TRANSACTION_TYPE",
    "SALE or LEASE"
  ),
  status: optionalEnum(
    query.status,
    listingStatuses,
    "STATUS",
    "INACTIVE, PUBLISHED, PAUSED, EXPIRED, SOLD, WITHDRAWN, or SUSPENDED"
  ),
  propertyTypeId: optionalUuid(query.propertyTypeId, "propertyTypeId"),
  locationId: optionalUuid(query.locationId, "locationId"),
  minPrice: optionalPriceMinor(query.minPrice, "MIN_PRICE"),
  maxPrice: optionalPriceMinor(query.maxPrice, "MAX_PRICE")
});

/**
 * WHERE fragment expecting joins aliased as: l = marketplace.listings,
 * p = land.properties, ploc = land.property_locations. Placeholders
 * start at $2 so callers can put their own owner id filter at $1.
 */
export const listingFilterWhere = `
  AND ($2::varchar IS NULL OR l.title ILIKE $2)
  AND ($3::varchar IS NULL OR l.transaction_type = $3)
  AND ($4::varchar IS NULL OR l.status = $4)
  AND ($5::uuid IS NULL OR p.property_type_id = $5)
  AND ($6::uuid IS NULL OR ploc.location_id = $6)
  AND ($7::bigint IS NULL OR l.price_amount_minor >= $7)
  AND ($8::bigint IS NULL OR l.price_amount_minor <= $8)
`;

export const listingFilterJoins = `
  JOIN marketplace.listings l ON l.id = source.listing_id AND l.deleted_at IS NULL
  LEFT JOIN land.properties p ON p.id = l.property_id
  LEFT JOIN land.property_locations ploc ON ploc.property_id = p.id
`;

export const listingFilterParams = ({
  search,
  transactionType,
  status,
  propertyTypeId,
  locationId,
  minPrice,
  maxPrice
}) => [
  search ? `%${search}%` : null,
  transactionType,
  status,
  propertyTypeId,
  locationId,
  minPrice,
  maxPrice
];

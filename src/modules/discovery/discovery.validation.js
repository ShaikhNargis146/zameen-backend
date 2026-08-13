import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const transactionTypes = new Set(["SALE", "LEASE"]);
const facings = new Set(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const sellerTypes = new Set(["OWNER", "BROKER", "DEVELOPER"]);
const sortValues = new Set([
  "RELEVANCE",
  "NEWEST",
  "PRICE_ASC",
  "PRICE_DESC",
  "AREA_ASC",
  "AREA_DESC"
]);

const invalid = (code, message) => {
  throw new HttpError(400, code, message);
};
const optionalNumber = (value, field, { min = 0, integer = false } = {}) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < min ||
    (integer && !Number.isInteger(number))
  )
    invalid("VALIDATION_ERROR", `${field} is invalid.`);
  return number;
};
const optionalBoolean = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (["true", "1"].includes(String(value).toLowerCase())) return true;
  if (["false", "0"].includes(String(value).toLowerCase())) return false;
  invalid("VALIDATION_ERROR", `${field} must be a boolean.`);
};
const uuidList = (value, field) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    invalid("VALIDATION_ERROR", `${field} must be an array.`);
  const ids = [...new Set(value.map(item => String(item).trim()))];
  if (ids.some(id => !uuidPattern.test(id)))
    invalid("INVALID_ID", `${field} must contain UUIDs only.`);
  return ids;
};
const enumList = (value, values, field) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    invalid("VALIDATION_ERROR", `${field} must be an array.`);
  const items = [
    ...new Set(
      value.map(item =>
        String(item)
          .trim()
          .toUpperCase()
      )
    )
  ];
  if (items.some(item => !values.has(item)))
    invalid("VALIDATION_ERROR", `${field} contains an invalid value.`);
  return items;
};

export const search = (body = {}) => {
  const minPriceMinor = optionalNumber(body.minPriceMinor, "minPriceMinor", {
    integer: true
  });
  const maxPriceMinor = optionalNumber(body.maxPriceMinor, "maxPriceMinor", {
    integer: true
  });
  const minArea = optionalNumber(body.minArea, "minArea");
  const maxArea = optionalNumber(body.maxArea, "maxArea");
  if (
    maxPriceMinor !== null &&
    minPriceMinor !== null &&
    maxPriceMinor < minPriceMinor
  )
    invalid(
      "VALIDATION_ERROR",
      "maxPriceMinor must be greater than or equal to minPriceMinor."
    );
  if (maxArea !== null && minArea !== null && maxArea < minArea)
    invalid(
      "VALIDATION_ERROR",
      "maxArea must be greater than or equal to minArea."
    );
  const areaUnitId = body.areaUnitId
    ? uuidList([body.areaUnitId], "areaUnitId")[0]
    : null;
  if ((minArea !== null || maxArea !== null) && !areaUnitId)
    invalid(
      "AREA_UNIT_REQUIRED",
      "areaUnitId is required with an area filter."
    );
  const page = Math.min(Math.max(Number(body.page || 1), 1), 10000);
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 100);
  return {
    locationIds: uuidList(body.locationIds, "locationIds"),
    propertyTypeIds: uuidList(body.propertyTypeIds, "propertyTypeIds"),
    transactionTypes: enumList(
      body.transactionTypes,
      transactionTypes,
      "transactionTypes"
    ),
    minPriceMinor,
    maxPriceMinor,
    minArea,
    maxArea,
    areaUnitId,
    verifiedOnly: optionalBoolean(body.verifiedOnly, "verifiedOnly") || false,
    minRoadWidthM: optionalNumber(body.minRoadWidthM, "minRoadWidthM"),
    facing: enumList(body.facing, facings, "facing"),
    cornerPlot: optionalBoolean(body.cornerPlot, "cornerPlot"),
    sellerType: enumList(body.sellerType, sellerTypes, "sellerType"),
    sort: sortValues.has(String(body.sort || "RELEVANCE").toUpperCase())
      ? String(body.sort || "RELEVANCE").toUpperCase()
      : invalid("VALIDATION_ERROR", "sort is invalid."),
    page,
    limit,
    offset: (page - 1) * limit
  };
};

export const suggestions = query => {
  const q = String(query.q || "").trim();
  if (q.length < 2 || q.length > 100)
    invalid("VALIDATION_ERROR", "q must contain 2 to 100 characters.");
  return { q, limit: Math.min(Math.max(Number(query.limit || 10), 1), 25) };
};

export const map = body => {
  const bounds = body?.bounds || {};
  const north = optionalNumber(bounds.north, "bounds.north", { min: -90 });
  const south = optionalNumber(bounds.south, "bounds.south", { min: -90 });
  const east = optionalNumber(bounds.east, "bounds.east", { min: -180 });
  const west = optionalNumber(bounds.west, "bounds.west", { min: -180 });
  if (
    [north, south, east, west].some(value => value === null) ||
    north > 90 ||
    south > 90 ||
    east > 180 ||
    west > 180 ||
    north < south
  )
    invalid(
      "VALIDATION_ERROR",
      "bounds must be valid north, south, east and west coordinates."
    );
  const filters = search({ ...(body.filters || {}), page: 1, limit: 1000 });
  return {
    ...filters,
    north,
    south,
    east,
    west,
    maxPins: Math.min(Math.max(Number(body.maxPins || 250), 1), 1000)
  };
};

export const listingId = value => uuidList([value], "listingId")[0];
export const compare = body => {
  const listingIds = uuidList(body?.listingIds, "listingIds");
  if (listingIds.length < 2 || listingIds.length > 4)
    invalid(
      "VALIDATION_ERROR",
      "listingIds must contain 2 to 4 unique listings."
    );
  return listingIds;
};

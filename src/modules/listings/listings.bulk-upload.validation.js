import { isUuid } from "../../shared/request-validation.js";
import {
  DIMENSION_UNITS,
  FACINGS,
  LANGUAGES,
  LOCATION_PRECISIONS,
  ROAD_ACCESS_TYPES,
  ROAD_TYPES,
  TERRAINS,
  TRANSACTION_TYPES
} from "./listings.bulk-upload.constants.js";

// CSV cells are always plain strings (or undefined for a short/ragged row);
// this just guards against those two absent-value cases.
const cellText = raw => {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
};
const isBlankRow = values => values.every(value => cellText(value) === "");

const requiredText = (raw, field, min, max, errors) => {
  const value = cellText(raw);
  if (!value) {
    errors.push({ field, message: `${field} is required.` });
    return null;
  }
  if (value.length < min || value.length > max) {
    errors.push({
      field,
      message: `${field} must contain ${min} to ${max} characters.`
    });
    return null;
  }
  return value;
};
const optionalText = (raw, field, max, errors) => {
  const value = cellText(raw);
  if (!value) return null;
  if (value.length > max) {
    errors.push({ field, message: `${field} must be at most ${max} characters.` });
    return null;
  }
  return value;
};
const requiredEnum = (raw, field, allowed, errors) => {
  const value = cellText(raw).toUpperCase();
  if (!value) {
    errors.push({ field, message: `${field} is required.` });
    return null;
  }
  if (!allowed.has(value)) {
    errors.push({
      field,
      message: `${field} must be one of: ${[...allowed].join(", ")}.`
    });
    return null;
  }
  return value;
};
const optionalEnum = (raw, field, allowed, errors) => {
  const text = cellText(raw);
  if (!text) return null;
  const value = text.toUpperCase();
  if (!allowed.has(value)) {
    errors.push({
      field,
      message: `${field} must be one of: ${[...allowed].join(", ")}.`
    });
    return null;
  }
  return value;
};
const optionalLowerEnum = (raw, field, allowed, errors, fallback) => {
  const text = cellText(raw);
  if (!text) return fallback;
  const value = text.toLowerCase();
  if (!allowed.has(value)) {
    errors.push({
      field,
      message: `${field} must be one of: ${[...allowed].join(", ")}.`
    });
    return fallback;
  }
  return value;
};
const requiredPositiveNumber = (raw, field, errors) => {
  const text = cellText(raw);
  if (!text) {
    errors.push({ field, message: `${field} is required.` });
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    errors.push({ field, message: `${field} must be a positive number.` });
    return null;
  }
  return value;
};
const optionalPositiveNumber = (raw, field, errors) => {
  const text = cellText(raw);
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) {
    errors.push({ field, message: `${field} must be a positive number.` });
    return null;
  }
  return value;
};
const optionalNonNegativeNumber = (raw, field, errors) => {
  const text = cellText(raw);
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    errors.push({ field, message: `${field} must be a non-negative number.` });
    return null;
  }
  return value;
};
const optionalIntegerInRange = (raw, field, min, max, errors) => {
  const text = cellText(raw);
  if (!text) return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push({
      field,
      message: `${field} must be a whole number from ${min} to ${max}.`
    });
    return null;
  }
  return value;
};
const optionalBoolean = (raw, field, errors, fallback = null) => {
  const text = cellText(raw).toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes"].includes(text)) return true;
  if (["false", "0", "no"].includes(text)) return false;
  errors.push({ field, message: `${field} must be TRUE or FALSE.` });
  return fallback;
};
const requiredUuid = (raw, field, errors) => {
  const value = cellText(raw);
  if (!value) {
    errors.push({ field, message: `${field} is required.` });
    return null;
  }
  if (!isUuid(value)) {
    errors.push({ field, message: `${field} must be a valid UUID.` });
    return null;
  }
  return value.toLowerCase();
};
const optionalUuid = (raw, field, errors) => {
  const value = cellText(raw);
  if (!value) return null;
  if (!isUuid(value)) {
    errors.push({ field, message: `${field} must be a valid UUID.` });
    return null;
  }
  return value.toLowerCase();
};
const optionalRangedNumber = (raw, field, min, max, errors) => {
  const text = cellText(raw);
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max) {
    errors.push({ field, message: `${field} must be a number from ${min} to ${max}.` });
    return null;
  }
  return value;
};
const optionalPincode = (raw, field, errors) => {
  const value = cellText(raw);
  if (!value) return null;
  if (!/^\d{6}$/.test(value)) {
    errors.push({ field, message: `${field} must contain 6 digits.` });
    return null;
  }
  return value;
};
// "WATER;ELECTRICITY:Available 24x7" -> [{ code: "WATER", valueText: null }, { code: "ELECTRICITY", valueText: "Available 24x7" }]
const optionalAmenityCodes = (raw, field, errors) => {
  const text = cellText(raw);
  if (!text) return [];
  const entries = text
    .split(";")
    .map(part => part.trim())
    .filter(Boolean);
  const codes = new Set();
  const result = [];
  for (const entry of entries) {
    const [codePart, ...noteParts] = entry.split(":");
    const code = codePart.trim().toUpperCase();
    if (!code) continue;
    if (codes.has(code)) {
      errors.push({ field, message: `${field} lists ${code} more than once.` });
      continue;
    }
    codes.add(code);
    const valueText = noteParts.join(":").trim();
    result.push({ code, valueText: valueText ? valueText.slice(0, 255) : null });
  }
  return result;
};

/**
 * Parses one CSV row into a normalized, field-validated object.
 * Cross-reference checks (does this code/id actually exist) happen later,
 * once master data and referenced locations are preloaded in bulk.
 */
export const parseRow = valuesByColumn => {
  const errors = [];
  const get = key => valuesByColumn[key];
  if (isBlankRow(Object.values(valuesByColumn))) return { blank: true };

  const data = {
    title: requiredText(get("title"), "title", 10, 255, errors),
    description: requiredText(get("description"), "description", 20, 5000, errors),
    transactionType: requiredEnum(
      get("transactionType"),
      "transactionType",
      TRANSACTION_TYPES,
      errors
    ),
    priceAmountINR: requiredPositiveNumber(
      get("priceAmountINR"),
      "priceAmountINR",
      errors
    ),
    isNegotiable: optionalBoolean(get("isNegotiable"), "isNegotiable", errors, false),
    canonicalLanguage: optionalLowerEnum(
      get("canonicalLanguage"),
      "canonicalLanguage",
      LANGUAGES,
      errors,
      "en"
    ),
    propertyTypeCode: requiredText(
      get("propertyTypeCode"),
      "propertyTypeCode",
      1,
      50,
      errors
    )?.toUpperCase(),
    landUseTypeCode: optionalText(get("landUseTypeCode"), "landUseTypeCode", 50, errors)?.toUpperCase() || null,
    ownershipTypeCode: optionalText(get("ownershipTypeCode"), "ownershipTypeCode", 50, errors)?.toUpperCase() || null,
    organizationId: optionalUuid(get("organizationId"), "organizationId", errors),
    areaValue: requiredPositiveNumber(get("areaValue"), "areaValue", errors),
    areaUnitCode: requiredText(get("areaUnitCode"), "areaUnitCode", 1, 30, errors)?.toUpperCase(),
    lengthValue: optionalPositiveNumber(get("lengthValue"), "lengthValue", errors),
    widthValue: optionalPositiveNumber(get("widthValue"), "widthValue", errors),
    dimensionUnit: optionalEnum(get("dimensionUnit"), "dimensionUnit", DIMENSION_UNITS, errors),
    frontageM: optionalNonNegativeNumber(get("frontageM"), "frontageM", errors),
    roadWidthM: optionalNonNegativeNumber(get("roadWidthM"), "roadWidthM", errors),
    roadType: optionalEnum(get("roadType"), "roadType", ROAD_TYPES, errors),
    facing: optionalEnum(get("facing"), "facing", FACINGS, errors),
    openSides: optionalIntegerInRange(get("openSides"), "openSides", 0, 4, errors),
    isCornerPlot: optionalBoolean(get("isCornerPlot"), "isCornerPlot", errors, false),
    hasBoundaryWall: optionalBoolean(get("hasBoundaryWall"), "hasBoundaryWall", errors, null),
    terrain: optionalEnum(get("terrain"), "terrain", TERRAINS, errors),
    roadAccessType: optionalEnum(
      get("roadAccessType"),
      "roadAccessType",
      ROAD_ACCESS_TYPES,
      errors
    ),
    locationId: requiredUuid(get("locationId"), "locationId", errors),
    pincode: optionalPincode(get("pincode"), "pincode", errors),
    addressLine: optionalText(get("addressLine"), "addressLine", 500, errors),
    landmark: optionalText(get("landmark"), "landmark", 255, errors),
    latitude: optionalRangedNumber(get("latitude"), "latitude", -90, 90, errors),
    longitude: optionalRangedNumber(get("longitude"), "longitude", -180, 180, errors),
    locationPrecision:
      optionalEnum(get("locationPrecision"), "locationPrecision", LOCATION_PRECISIONS, errors) ||
      "APPROXIMATE",
    showExactLocation: optionalBoolean(
      get("showExactLocation"),
      "showExactLocation",
      errors,
      false
    ),
    amenityCodes: optionalAmenityCodes(get("amenityCodes"), "amenityCodes", errors)
  };
  if ((data.latitude == null) !== (data.longitude == null))
    errors.push({
      field: "latitude",
      message: "latitude and longitude must both be provided, or both left blank."
    });
  return { blank: false, errors, data };
};

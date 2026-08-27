import { HttpError } from "../../shared/http.js";
import { isUuid } from "../../shared/request-validation.js";

const propertyStatuses = new Set(["ACTIVE", "ARCHIVED"]);
const verificationTypes = new Set([
  "LOCATION",
  "LAND_DETAILS",
  "PARCEL_IDENTITY",
  "DOCUMENTS",
  "SITE_VISIT"
]);
const facings = new Set(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const dimensionUnits = new Set(["FT", "M"]);
const roadTypes = new Set(["PUCCA", "KUTCHA", "HIGHWAY", "OTHER"]);
const terrains = new Set(["FLAT", "SLOPED", "UNEVEN", "OTHER"]);
const roadAccessTypes = new Set(["DIRECT", "SHARED", "NO_DIRECT", "OTHER"]);
const locationPrecisions = new Set(["EXACT", "APPROXIMATE"]);
const documentMimeTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);
const mediaMimeTypes = new Map([
  ["IMAGE", new Set(["image/jpeg", "image/png", "image/webp"])],
  ["VIDEO", new Set(["video/mp4", "video/webm"])],
  ["DRONE_VIDEO", new Set(["video/mp4", "video/webm"])],
  [
    "SITE_PLAN",
    new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"])
  ]
]);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const positive = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0)
    throw new HttpError(400, "VALIDATION_ERROR", `${field} must be positive.`, [
      { field, message: "Must be greater than zero." }
    ]);
  return number;
};
const boolean = (value, field, fallback = null) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value)
    .trim()
    .toLowerCase();
  if (["true", "1"].includes(normalized)) return true;
  if (["false", "0"].includes(normalized)) return false;
  throw new HttpError(400, "VALIDATION_ERROR", `${field} must be a boolean.`);
};
const optionalEnum = (value, field, values) => {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value)
    .trim()
    .toUpperCase();
  if (!values.has(normalized))
    throw new HttpError(400, "VALIDATION_ERROR", `${field} is invalid.`);
  return normalized;
};
const nonNegative = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must be a non-negative number.`
    );
  return number;
};
const integerInRange = (value, field, min, max) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must be an integer from ${min} to ${max}.`
    );
  return number;
};

export const createProperty = body => {
  if (!body.propertyTypeId)
    throw new HttpError(
      400,
      "PROPERTY_TYPE_REQUIRED",
      "propertyTypeId is required."
    );
  return {
    propertyTypeId: body.propertyTypeId,
    landUseTypeId: body.landUseTypeId || null,
    ownershipTypeId: body.ownershipTypeId || null,
    organizationId: body.organizationId || body.ownerOrganizationId || null
  };
};
export const updateProperty = body => {
  const fields = {
    propertyTypeId: "property_type_id",
    landUseTypeId: "land_use_type_id",
    ownershipTypeId: "ownership_type_id"
  };
  const changes = {};
  for (const [input, column] of Object.entries(fields))
    if (has(body, input)) changes[column] = body[input] || null;
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};
export const propertyList = query => {
  const status = query.status ? String(query.status).toUpperCase() : null;
  if (status && !propertyStatuses.has(status))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "status must be ACTIVE or ARCHIVED."
    );
  const page =
    query.page === undefined ? 1 : integerInRange(query.page, "page", 1, 10000);
  const limit =
    query.limit === undefined
      ? 20
      : integerInRange(query.limit, "limit", 1, 100);
  const search = String(query.search || "").trim();
  if (search.length > 200)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "search must be at most 200 characters."
    );
  return {
    page,
    limit,
    status,
    search: search || null
  };
};
export const landDetails = body => ({
  areaValue: positive(body.areaValue, "areaValue"),
  areaUnitId:
    body.areaUnitId ||
    (() => {
      throw new HttpError(400, "AREA_REQUIRED", "areaUnitId is required.");
    })(),
  lengthValue:
    body.lengthValue == null ? null : positive(body.lengthValue, "lengthValue"),
  widthValue:
    body.widthValue == null ? null : positive(body.widthValue, "widthValue"),
  dimensionUnit: optionalEnum(
    body.dimensionUnit,
    "dimensionUnit",
    dimensionUnits
  ),
  frontageM: nonNegative(body.frontageM, "frontageM"),
  roadWidthM: nonNegative(body.roadWidthM, "roadWidthM"),
  roadType: optionalEnum(body.roadType, "roadType", roadTypes),
  facing: optionalEnum(body.facing, "facing", facings),
  openSides:
    body.openSides === undefined || body.openSides === null
      ? null
      : integerInRange(body.openSides, "openSides", 0, 4),
  isCornerPlot: boolean(body.isCornerPlot, "isCornerPlot", false),
  hasBoundaryWall: boolean(body.hasBoundaryWall, "hasBoundaryWall"),
  terrain: optionalEnum(body.terrain, "terrain", terrains),
  roadAccessType: optionalEnum(
    body.roadAccessType,
    "roadAccessType",
    roadAccessTypes
  )
});
export const propertyLocation = body => {
  if (!body.locationId)
    throw new HttpError(400, "LOCATION_REQUIRED", "locationId is required.");
  if (!isUuid(body.locationId))
    throw new HttpError(400, "INVALID_ID", "locationId must be a valid UUID.");
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  )
    throw new HttpError(
      400,
      "INVALID_COORDINATES",
      "latitude and longitude are required numeric values."
    );
  const pincode = body.pincode == null ? null : String(body.pincode).trim();
  if (pincode && !/^\d{6}$/.test(pincode))
    throw new HttpError(
      400,
      "INVALID_PINCODE",
      "pincode must contain 6 digits."
    );
  const addressLine = body.addressLine ? String(body.addressLine).trim() : null;
  const landmark = body.landmark ? String(body.landmark).trim() : null;
  if (addressLine && addressLine.length > 500)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "addressLine must be at most 500 characters."
    );
  if (landmark && landmark.length > 255)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "landmark must be at most 255 characters."
    );
  return {
    locationId: body.locationId,
    pincode,
    addressLine,
    landmark,
    latitude,
    longitude,
    locationPrecision:
      optionalEnum(
        body.locationPrecision || "EXACT",
        "locationPrecision",
        locationPrecisions
      ) || "EXACT",
    showExactLocation: boolean(
      body.showExactLocation,
      "showExactLocation",
      false
    )
  };
};
export const amenities = body => {
  if (!Array.isArray(body.amenities))
    throw new HttpError(
      400,
      "INVALID_AMENITIES",
      "amenities must be an array."
    );
  const result = body.amenities.map(item =>
    typeof item === "string"
      ? { amenityId: item, valueText: null }
      : {
          amenityId: item.amenityId || item.id,
          valueText: item.valueText || null
        }
  );
  if (
    result.some(item => !item.amenityId) ||
    new Set(result.map(item => item.amenityId)).size !== result.length
  )
    throw new HttpError(
      400,
      "INVALID_AMENITIES",
      "Each amenity must be unique and valid."
    );
  return result;
};
export const identifiers = body => {
  if (!Array.isArray(body.identifiers))
    throw new HttpError(
      400,
      "INVALID_IDENTIFIERS",
      "identifiers must be an array."
    );
  return body.identifiers.map(item => {
    const type = String(item.type || "").toUpperCase();
    const value = String(item.value || "").trim();
    if (!type || !value)
      throw new HttpError(
        400,
        "INVALID_IDENTIFIERS",
        "Each identifier requires type and value."
      );
    return { type, value };
  });
};
export const verificationRequest = body => {
  const note = body.note == null ? null : String(body.note).trim();
  if (note && note.length > 500)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "note must be at most 500 characters."
    );
  if (body.checkTypes == null)
    return { checkTypes: [...verificationTypes], note };
  if (!Array.isArray(body.checkTypes))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "checkTypes must be an array."
    );
  const values = [
    ...new Set(body.checkTypes.map(value => String(value).toUpperCase()))
  ];
  if (!values.length || values.some(value => !verificationTypes.has(value)))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Invalid verification check type."
    );
  return { checkTypes: values, note };
};
const fileInput = (body, acceptedMediaTypes = null) => {
  const fileName = String(body.fileName || "").trim();
  const mimeType = String(body.mimeType || "")
    .trim()
    .toLowerCase();
  const fileSizeBytes = Number(body.fileSizeBytes);
  if (
    !fileName ||
    fileName.length > 255 ||
    !mimeType ||
    !Number.isInteger(fileSizeBytes) ||
    fileSizeBytes <= 0 ||
    fileSizeBytes > 50 * 1024 * 1024
  )
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "fileName, mimeType, and fileSizeBytes are required."
    );
  const mediaType = body.mediaType
    ? String(body.mediaType).toUpperCase()
    : null;
  if (acceptedMediaTypes && !acceptedMediaTypes.has(mediaType))
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid mediaType.");
  if (!acceptedMediaTypes && mediaType)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "mediaType is only valid for property media."
    );
  const allowedMimeTypes = acceptedMediaTypes
    ? mediaMimeTypes.get(mediaType)
    : documentMimeTypes;
  if (!allowedMimeTypes?.has(mimeType))
    throw new HttpError(400, "VALIDATION_ERROR", "Unsupported mimeType.");
  return { fileName, mimeType, fileSizeBytes, mediaType };
};
const mediaTypes = new Set(["IMAGE", "VIDEO", "DRONE_VIDEO", "SITE_PLAN"]);
export const mediaUpload = body => fileInput(body, mediaTypes);
export const mediaComplete = body => {
  const input = fileInput(body, mediaTypes);
  if (!body.storageKey)
    throw new HttpError(400, "VALIDATION_ERROR", "storageKey is required.");
  return {
    ...input,
    storageKey: String(body.storageKey),
    sortOrder:
      Number.isInteger(body.sortOrder) && body.sortOrder >= 0
        ? body.sortOrder
        : 0,
    isCover: boolean(body.isCover, "isCover", false),
    caption: body.caption ? String(body.caption).slice(0, 255) : null
  };
};
export const mediaUpdate = body => {
  const changes = {};
  if (has(body, "caption"))
    changes.caption = body.caption ? String(body.caption).slice(0, 255) : null;
  if (has(body, "sortOrder")) {
    if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0)
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "sortOrder must be a non-negative integer."
      );
    changes.sort_order = body.sortOrder;
  }
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};
export const mediaOrder = body => {
  if (
    !Array.isArray(body.mediaIds) ||
    !body.mediaIds.length ||
    new Set(body.mediaIds).size !== body.mediaIds.length
  )
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "mediaIds must be a unique non-empty array."
    );
  return body.mediaIds;
};
export const documentUpload = body => fileInput(body);
export const documentComplete = body => {
  const input = fileInput(body);
  const visibility = String(body.visibility || "PRIVATE").toUpperCase();
  if (
    !body.storageKey ||
    !body.documentTypeId ||
    !isUuid(body.documentTypeId) ||
    !["PRIVATE", "OWNER_ONLY", "APPROVED_BUYERS"].includes(visibility)
  )
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "storageKey, a valid documentTypeId, and visibility are required."
    );
  return {
    ...input,
    storageKey: String(body.storageKey),
    documentTypeId: body.documentTypeId,
    visibility
  };
};

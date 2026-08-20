import { HttpError } from "../../shared/http.js";

const propertyStatuses = new Set(["ACTIVE", "ARCHIVED"]);
const verificationTypes = new Set([
  "LOCATION",
  "LAND_DETAILS",
  "PARCEL_IDENTITY",
  "DOCUMENTS",
  "SITE_VISIT"
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
    ownershipTypeId: "ownership_type_id",
    status: "status"
  };
  const changes = {};
  for (const [input, column] of Object.entries(fields))
    if (has(body, input)) changes[column] = body[input] || null;
  if (changes.status && !propertyStatuses.has(changes.status))
    throw new HttpError(
      400,
      "INVALID_PROPERTY_STATUS",
      "status must be ACTIVE or ARCHIVED."
    );
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
  return {
    page: Math.max(Number(query.page || 1), 1),
    limit: Math.min(Math.max(Number(query.limit || 20), 1), 100),
    status,
    search: String(query.search || "").trim() || null
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
  dimensionUnitId: body.dimensionUnitId || null,
  frontageM: body.frontageM == null ? null : Number(body.frontageM),
  roadWidthM: body.roadWidthM == null ? null : Number(body.roadWidthM),
  roadTypeId: body.roadTypeId || null,
  facing: body.facing || null,
  openSides: body.openSides ?? null,
  isCornerPlot: boolean(body.isCornerPlot, "isCornerPlot", false),
  hasBoundaryWall: boolean(body.hasBoundaryWall, "hasBoundaryWall"),
  terrain: body.terrain || null,
  roadAccessType: body.roadAccessType || null
});
export const propertyLocation = body => {
  if (!body.locationId)
    throw new HttpError(400, "LOCATION_REQUIRED", "locationId is required.");
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    throw new HttpError(
      400,
      "INVALID_COORDINATES",
      "latitude and longitude are required numeric values."
    );
  return {
    locationId: body.locationId,
    pincode: body.pincode ? String(body.pincode) : null,
    addressLine: body.addressLine || null,
    landmark: body.landmark || null,
    latitude,
    longitude,
    locationPrecision: body.locationPrecision || "EXACT",
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
    !["PRIVATE", "OWNER_ONLY", "APPROVED_BUYERS"].includes(visibility)
  )
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "storageKey, documentTypeId, and visibility are required."
    );
  return {
    ...input,
    storageKey: String(body.storageKey),
    documentTypeId: body.documentTypeId,
    visibility
  };
};

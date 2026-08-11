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
  isCornerPlot: Boolean(body.isCornerPlot),
  hasBoundaryWall: body.hasBoundaryWall ?? null,
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
    showExactLocation: Boolean(body.showExactLocation)
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
  if (body.checkTypes == null) return [...verificationTypes];
  const values = [
    ...new Set(body.checkTypes.map(value => String(value).toUpperCase()))
  ];
  if (!values.length || values.some(value => !verificationTypes.has(value)))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "Invalid verification check type."
    );
  return values;
};

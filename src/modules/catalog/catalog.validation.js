import { HttpError } from "../../shared/http.js";

const locationTypes = new Set([
  "COUNTRY",
  "STATE",
  "DISTRICT",
  "SUBDISTRICT",
  "CITY",
  "LOCALITY",
  "VILLAGE"
]);

export const searchQuery = query => {
  const value = String(query.q || "").trim();
  if (value.length < 2 || value.length > 100)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "q must contain 2 to 100 characters.",
      [{ field: "q", message: "Must contain 2 to 100 characters." }]
    );
  return value;
};
export const stateCode = value =>
  String(value || "")
    .trim()
    .toUpperCase();
export const locationSearch = query => {
  const types = query.types
    ? String(query.types)
        .split(",")
        .map(value => value.trim().toUpperCase())
        .filter(Boolean)
    : null;
  if (types?.some(type => !locationTypes.has(type)))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "types contains an unsupported location type."
    );
  const limit = Number(query.limit || 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "limit must be an integer from 1 to 25."
    );
  return {
    q: searchQuery(query),
    types: types?.length ? types : null,
    stateCode: query.stateCode ? stateCode(query.stateCode) : null,
    limit
  };
};
export const locationType = query => {
  if (!query.type) return null;
  const type = String(query.type)
    .trim()
    .toUpperCase();
  if (!locationTypes.has(type))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "type is an unsupported location type."
    );
  return type;
};
export const coordinates = query => {
  const latitude = Number(query.lat);
  const longitude = Number(query.lng);
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
      "VALIDATION_ERROR",
      "lat and lng must be valid coordinates."
    );
  return { latitude, longitude };
};

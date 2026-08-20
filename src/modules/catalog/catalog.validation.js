import { HttpError } from "../../shared/http.js";

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
  return {
    q: searchQuery(query),
    types: types?.length ? types : null,
    stateCode: query.stateCode ? stateCode(query.stateCode) : null,
    limit: Math.min(Math.max(Number(query.limit || 10), 1), 25)
  };
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

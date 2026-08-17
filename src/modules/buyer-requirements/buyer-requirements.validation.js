import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const purposes = new Set([
  "INVESTMENT",
  "RESIDENTIAL",
  "INDUSTRIAL",
  "COMMERCIAL",
  "WAREHOUSE",
  "AGRICULTURE",
  "OTHER"
]);
const statuses = new Set(["ACTIVE", "PAUSED", "CLOSED"]);

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};

const optionalUuid = (value, field) =>
  value === undefined || value === null || value === "" ? null : uuid(value, field);

const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max)
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be at most ${max} characters.`
    );
  return text;
};

const optionalNumber = (value, field, { min } = {}) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num) || (min !== undefined && num < min))
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be a number${min !== undefined ? ` >= ${min}` : ""}.`
    );
  return num;
};

const optionalInteger = (value, field, { min } = {}) => {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (!Number.isInteger(num) || (min !== undefined && num < min))
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be a whole number${min !== undefined ? ` >= ${min}` : ""}.`
    );
  return num;
};

const optionalPurpose = value => {
  if (value === undefined || value === null || value === "") return null;
  const purpose = String(value).trim().toUpperCase();
  if (!purposes.has(purpose))
    throw new HttpError(
      400,
      "INVALID_PURPOSE",
      "purpose must be one of INVESTMENT, RESIDENTIAL, INDUSTRIAL, COMMERCIAL, WAREHOUSE, AGRICULTURE, OTHER."
    );
  return purpose;
};

const optionalStatus = value => {
  if (value === undefined || value === null || value === "") return null;
  const status = String(value).trim().toUpperCase();
  if (!statuses.has(status))
    throw new HttpError(
      400,
      "INVALID_STATUS",
      "status must be ACTIVE, PAUSED, or CLOSED."
    );
  return status;
};

export const buyerRequirementInput = body => ({
  name: optionalString(body.name, 255, "NAME"),
  locationId: optionalUuid(body.locationId, "locationId"),
  propertyTypeId: optionalUuid(body.propertyTypeId, "propertyTypeId"),
  minArea: optionalNumber(body.minArea, "MIN_AREA", { min: 0 }),
  maxArea: optionalNumber(body.maxArea, "MAX_AREA", { min: 0 }),
  areaUnitId: optionalUuid(body.areaUnitId, "areaUnitId"),
  minBudgetMinor: optionalInteger(body.minBudgetMinor, "MIN_BUDGET_MINOR", { min: 0 }),
  maxBudgetMinor: optionalInteger(body.maxBudgetMinor, "MAX_BUDGET_MINOR", { min: 0 }),
  purpose: optionalPurpose(body.purpose),
  roadWidthMinM: optionalNumber(body.roadWidthMinM, "ROAD_WIDTH_MIN_M", { min: 0 }),
  verifiedOnly: body.verifiedOnly === undefined ? false : Boolean(body.verifiedOnly),
  status: optionalStatus(body.status)
});

export const buyerRequirementChanges = body => {
  const changes = {};
  if (Object.hasOwn(body, "name")) changes.name = optionalString(body.name, 255, "NAME");
  if (Object.hasOwn(body, "locationId"))
    changes.locationId = optionalUuid(body.locationId, "locationId");
  if (Object.hasOwn(body, "propertyTypeId"))
    changes.propertyTypeId = optionalUuid(body.propertyTypeId, "propertyTypeId");
  if (Object.hasOwn(body, "minArea"))
    changes.minArea = optionalNumber(body.minArea, "MIN_AREA", { min: 0 });
  if (Object.hasOwn(body, "maxArea"))
    changes.maxArea = optionalNumber(body.maxArea, "MAX_AREA", { min: 0 });
  if (Object.hasOwn(body, "areaUnitId"))
    changes.areaUnitId = optionalUuid(body.areaUnitId, "areaUnitId");
  if (Object.hasOwn(body, "minBudgetMinor"))
    changes.minBudgetMinor = optionalInteger(body.minBudgetMinor, "MIN_BUDGET_MINOR", { min: 0 });
  if (Object.hasOwn(body, "maxBudgetMinor"))
    changes.maxBudgetMinor = optionalInteger(body.maxBudgetMinor, "MAX_BUDGET_MINOR", { min: 0 });
  if (Object.hasOwn(body, "purpose")) changes.purpose = optionalPurpose(body.purpose);
  if (Object.hasOwn(body, "roadWidthMinM"))
    changes.roadWidthMinM = optionalNumber(body.roadWidthMinM, "ROAD_WIDTH_MIN_M", { min: 0 });
  if (Object.hasOwn(body, "verifiedOnly")) changes.verifiedOnly = Boolean(body.verifiedOnly);
  if (Object.hasOwn(body, "status")) changes.status = optionalStatus(body.status);
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};

const optionalBoolean = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["true", "1"].includes(text)) return true;
  if (["false", "0"].includes(text)) return false;
  throw new HttpError(400, `INVALID_${field}`, `${field} must be a boolean.`);
};

export const listQuery = query => ({
  search: optionalString(query.search, 255, "SEARCH"),
  locationId: optionalUuid(query.locationId, "locationId"),
  propertyTypeId: optionalUuid(query.propertyTypeId, "propertyTypeId"),
  purpose: optionalPurpose(query.purpose),
  status: optionalStatus(query.status),
  verifiedOnly: optionalBoolean(query.verifiedOnly, "VERIFIED_ONLY")
});

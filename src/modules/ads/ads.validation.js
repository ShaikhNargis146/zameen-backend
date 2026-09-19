import { HttpError } from "../../shared/http.js";
import { toField } from "../../shared/validation.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const placements = new Set(["HOME_TOP", "SEARCH_TOP", "PROPERTY_SIDEBAR", "CONTENT"]);
const adStatuses = new Set(["ACTIVE", "INACTIVE", "SCHEDULED", "EXPIRED"]);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`, [
      { field: toField(field), message: `${field} must be a valid UUID.` }
    ]);
  return text;
};

const requiredString = (value, min, max, field) => {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    const message = `${field} must be between ${min} and ${max} characters.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return text;
};

const optionalUrl = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  try {
    // eslint-disable-next-line no-new
    new URL(text);
  } catch {
    const message = `${field} must be a valid URL.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return text;
};

const requiredDateTime = (value, field) => {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.valueOf())) {
    const message = `${field} must be a valid date/time.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return date;
};

const requiredEnum = (value, set, code, label) => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!set.has(text)) {
    const message = `${code} must be ${label}.`;
    throw new HttpError(400, `INVALID_${code}`, message, [{ field: toField(code), message }]);
  }
  return text;
};

export const placement = value =>
  requiredEnum(value, placements, "PLACEMENT", "HOME_TOP, SEARCH_TOP, PROPERTY_SIDEBAR, or CONTENT");

export const createAd = body => {
  const startsAt = requiredDateTime(body.startsAt, "STARTS_AT");
  const endsAt = requiredDateTime(body.endsAt, "ENDS_AT");
  if (endsAt <= startsAt)
    throw new HttpError(400, "INVALID_ENDS_AT", "endsAt must be after startsAt.", [
      { field: "endsAt", message: "endsAt must be after startsAt." }
    ]);
  return {
    name: requiredString(body.name, 2, 255, "NAME"),
    placement: placement(body.placement),
    imageStorageKey: requiredString(body.imageStorageKey, 1, 2048, "IMAGE_STORAGE_KEY"),
    targetUrl: optionalUrl(body.targetUrl, "TARGET_URL"),
    startsAt,
    endsAt,
    status: body.status ? requiredEnum(body.status, adStatuses, "STATUS", "ACTIVE, INACTIVE, SCHEDULED, or EXPIRED") : "INACTIVE"
  };
};

const optionalEnum = (value, set, code, label) => {
  if (value === undefined || value === null || value === "") return null;
  return requiredEnum(value, set, code, label);
};

const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max) {
    const message = `${field} must be at most ${max} characters.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return text;
};

const maxFileSizeBytes = 50 * 1024 * 1024;

const fileInput = body => {
  const fileName = requiredString(body.fileName, 1, 255, "FILE_NAME");
  const mimeType = requiredString(body.mimeType, 1, 255, "MIME_TYPE").toLowerCase();
  const fileSizeBytes = Number(body.fileSizeBytes);
  if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > maxFileSizeBytes) {
    const message = `fileSizeBytes must be a positive whole number up to ${maxFileSizeBytes} bytes.`;
    throw new HttpError(400, "INVALID_FILE_SIZE_BYTES", message, [{ field: "fileSizeBytes", message }]);
  }
  return { fileName, mimeType, fileSizeBytes };
};

export const mediaUploadInit = body => fileInput(body);

export const mediaComplete = body => ({
  ...fileInput(body),
  storageKey: requiredString(body.storageKey, 1, 2048, "STORAGE_KEY")
});

export const adminAdListQuery = query => ({
  status: optionalEnum(query.status, adStatuses, "STATUS", "ACTIVE, INACTIVE, SCHEDULED, or EXPIRED"),
  placement: optionalEnum(
    query.placement,
    placements,
    "PLACEMENT",
    "HOME_TOP, SEARCH_TOP, PROPERTY_SIDEBAR, or CONTENT"
  ),
  search: optionalString(query.search, 200, "SEARCH")
});

export const updateAd = body => {
  const changes = {};
  if (has(body, "name")) changes.name = requiredString(body.name, 2, 255, "NAME");
  if (has(body, "placement")) changes.placement = placement(body.placement);
  if (has(body, "imageStorageKey"))
    changes.image_storage_key = requiredString(body.imageStorageKey, 1, 2048, "IMAGE_STORAGE_KEY");
  if (has(body, "targetUrl")) changes.target_url = optionalUrl(body.targetUrl, "TARGET_URL");
  if (has(body, "startsAt")) changes.starts_at = requiredDateTime(body.startsAt, "STARTS_AT");
  if (has(body, "endsAt")) changes.ends_at = requiredDateTime(body.endsAt, "ENDS_AT");
  if (has(body, "status"))
    changes.status = requiredEnum(body.status, adStatuses, "STATUS", "ACTIVE, INACTIVE, SCHEDULED, or EXPIRED");
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};


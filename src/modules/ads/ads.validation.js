import { HttpError } from "../../shared/http.js";
import { toField } from "../../shared/validation.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const adStatuses = new Set(["ACTIVE", "INACTIVE", "EXPIRED"]);
const adStatusLabel = "ACTIVE, INACTIVE, or EXPIRED";
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

export const placement = value => requiredString(value, 1, 50, "PLACEMENT").toUpperCase();

export const createAd = body => {
  const startsAt = requiredDateTime(body.startsAt, "STARTS_AT");
  const endsAt = requiredDateTime(body.endsAt, "ENDS_AT");
  if (endsAt <= startsAt)
    throw new HttpError(400, "INVALID_ENDS_AT", "endsAt must be after startsAt.", [
      { field: "endsAt", message: "endsAt must be after startsAt." }
    ]);
  const now = new Date();
  if (startsAt > now)
    throw new HttpError(400, "INVALID_STARTS_AT", "startsAt cannot be in the future — ads go live immediately, there is no scheduling.", [
      { field: "startsAt", message: "startsAt cannot be in the future." }
    ]);
  if (endsAt <= now)
    throw new HttpError(400, "INVALID_ENDS_AT", "endsAt must be in the future.", [
      { field: "endsAt", message: "endsAt must be in the future." }
    ]);
  return {
    name: requiredString(body.name, 2, 255, "NAME"),
    placement: placement(body.placement),
    targetUrl: optionalUrl(body.targetUrl, "TARGET_URL"),
    startsAt,
    endsAt,
    status: body.status ? requiredEnum(body.status, adStatuses, "STATUS", adStatusLabel) : "ACTIVE"
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

const boolean = (value, field, fallback = null) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1"].includes(normalized)) return true;
  if (["false", "0"].includes(normalized)) return false;
  const message = `${field} must be a boolean.`;
  throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
};

const maxFileSizeBytes = 50 * 1024 * 1024;
const adMediaMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm"
]);

const fileInput = body => {
  const fileName = requiredString(body.fileName, 1, 255, "FILE_NAME");
  const mimeType = requiredString(body.mimeType, 1, 255, "MIME_TYPE").toLowerCase();
  const fileSizeBytes = Number(body.fileSizeBytes);
  if (!Number.isInteger(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > maxFileSizeBytes) {
    const message = `fileSizeBytes must be a positive whole number up to ${maxFileSizeBytes} bytes.`;
    throw new HttpError(400, "INVALID_FILE_SIZE_BYTES", message, [{ field: "fileSizeBytes", message }]);
  }
  if (!adMediaMimeTypes.has(mimeType)) {
    const message = "mimeType must be image/jpeg, image/png, image/webp, video/mp4, or video/webm.";
    throw new HttpError(400, "INVALID_MIME_TYPE", message, [{ field: "mimeType", message }]);
  }
  return { fileName, mimeType, fileSizeBytes };
};

const maxFilesPerBatch = 8;
const batchFiles = body => {
  const files = body.files;
  if (!files.length)
    throw new HttpError(400, "VALIDATION_ERROR", "At least one file is required.", [
      { field: "files", message: "At least one file is required." }
    ]);
  if (files.length > maxFilesPerBatch) {
    const message = `A maximum of ${maxFilesPerBatch} files can be uploaded at a time.`;
    throw new HttpError(400, "VALIDATION_ERROR", message, [{ field: "files", message }]);
  }
  return files;
};

const mediaCompleteInput = body => ({
  ...fileInput(body),
  storageKey: requiredString(body.storageKey, 1, 2048, "STORAGE_KEY"),
  sortOrder: Number.isInteger(body.sortOrder) && body.sortOrder >= 0 ? body.sortOrder : 0,
  isCover: boolean(body.isCover, "isCover", false)
});

export const mediaUpload = body =>
  Array.isArray(body.files) ? batchFiles(body).map(fileInput) : fileInput(body);

export const mediaComplete = body =>
  Array.isArray(body.files) ? batchFiles(body).map(mediaCompleteInput) : mediaCompleteInput(body);

export const mediaUpdate = body => {
  const changes = {};
  if (has(body, "sortOrder")) {
    if (!Number.isInteger(body.sortOrder) || body.sortOrder < 0)
      throw new HttpError(400, "VALIDATION_ERROR", "sortOrder must be a non-negative integer.", [
        { field: "sortOrder", message: "sortOrder must be a non-negative integer." }
      ]);
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
    throw new HttpError(400, "VALIDATION_ERROR", "mediaIds must be a unique non-empty array.", [
      { field: "mediaIds", message: "mediaIds must be a unique non-empty array." }
    ]);
  return body.mediaIds;
};

export const adminAdListQuery = query => ({
  status: optionalEnum(query.status, adStatuses, "STATUS", adStatusLabel),
  placement: query.placement === undefined || query.placement === null || query.placement === ""
    ? null
    : placement(query.placement),
  search: optionalString(query.search, 200, "SEARCH")
});

export const updateAd = body => {
  const changes = {};
  if (has(body, "name")) changes.name = requiredString(body.name, 2, 255, "NAME");
  if (has(body, "placement")) changes.placement = placement(body.placement);
  if (has(body, "targetUrl")) changes.target_url = optionalUrl(body.targetUrl, "TARGET_URL");
  if (has(body, "startsAt")) changes.starts_at = requiredDateTime(body.startsAt, "STARTS_AT");
  if (has(body, "endsAt")) changes.ends_at = requiredDateTime(body.endsAt, "ENDS_AT");
  if (has(body, "status"))
    changes.status = requiredEnum(body.status, adStatuses, "STATUS", adStatusLabel);
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};


import { HttpError } from "../../shared/http.js";
import { toField } from "../../shared/validation.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contentTypes = new Set([
  "NEWS",
  "ARTICLE",
  "EBOOK",
  "LAND_OPPORTUNITY",
  "PROPERTY_LAW",
  "GUIDE"
]);
const contentStatuses = new Set(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const languages = new Set(["en", "hi", "mr", "gu", "pa", "te", "ta"]);
const metrics = new Set([
  "ASKING_PRICE",
  "GOVT_RATE",
  "AVG_PRICE_PER_SQFT",
  "AVG_PRICE_PER_ACRE"
]);
const minYear = 1900;
const maxYear = 2100;
const maxFileSizeBytes = 50 * 1024 * 1024;

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text)) {
    const message = `${field} must be a valid UUID.`;
    throw new HttpError(400, "INVALID_ID", message, [{ field: toField(field), message }]);
  }
  return text;
};
const optionalUuid = (value, field) =>
  value === undefined || value === null || value === "" ? null : uuid(value, field);

const requiredString = (value, min, max, field, detailsField = toField(field)) => {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) {
    const message = `${field} must be between ${min} and ${max} characters.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: detailsField, message }]);
  }
  return text;
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
const optionalText = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};
const requiredText = (value, field, detailsField = toField(field)) => {
  const text = String(value ?? "");
  if (!text.trim().length) {
    const message = `${field} is required.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: detailsField, message }]);
  }
  return text;
};

const requiredEnum = (value, set, code, label) => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!set.has(text)) {
    const message = `${code} must be ${label}.`;
    throw new HttpError(400, `INVALID_${code}`, message, [{ field: toField(code), message }]);
  }
  return text;
};
const optionalEnum = (value, set, code, label) => {
  if (value === undefined || value === null || value === "") return null;
  return requiredEnum(value, set, code, label);
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

export const language = value => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!languages.has(text)) {
    const message = "language must be one of en, hi, mr, gu, pa, te, ta.";
    throw new HttpError(400, "INVALID_LANGUAGE", message, [{ field: "language", message }]);
  }
  return text;
};
export const optionalLanguage = value =>
  value === undefined || value === null || value === "" ? "en" : language(value);
// Unlike optionalLanguage (used by the public single-language content read, which needs a
// concrete language to resolve), the admin list has no default: omitting it must mean "any
// language", not silently "en", so items authored only in another language stay visible.
const optionalAdminLanguage = value =>
  value === undefined || value === null || value === "" ? null : language(value);

const requiredYear = (value, field) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < minYear || num > maxYear) {
    const message = `${field} must be a year between ${minYear} and ${maxYear}.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return num;
};
const optionalYear = (value, field) =>
  value === undefined || value === null || value === "" ? null : requiredYear(value, field);

const requiredNonNegativeNumber = (value, field) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    const message = `${field} must be a number >= 0.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return num;
};

const periodDate = value => {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.valueOf())) {
    const message = "periodDate must be a valid date.";
    throw new HttpError(400, "INVALID_PERIOD_DATE", message, [{ field: "periodDate", message }]);
  }
  return date;
};

const translationInput = (entry, index) => ({
  language: language(entry?.language),
  slug: requiredString(entry?.slug, 1, 255, `TRANSLATIONS_${index}_SLUG`, `translations[${index}].slug`),
  title: requiredString(entry?.title, 1, 500, `TRANSLATIONS_${index}_TITLE`, `translations[${index}].title`),
  summary: optionalText(entry?.summary, `TRANSLATIONS_${index}_SUMMARY`),
  body: requiredText(entry?.body, `TRANSLATIONS_${index}_BODY`, `translations[${index}].body`)
});

export const contentListQuery = query => ({
  filters: {
    type: optionalEnum(query.type, contentTypes, "TYPE", "a valid ContentType"),
    language: optionalLanguage(query.language),
    locationId: optionalUuid(query.locationId, "locationId"),
    search: optionalString(query.search, 200, "SEARCH")
  },
  query
});

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

export const adminContentListQuery = query => ({
  filters: {
    status: optionalEnum(query.status, contentStatuses, "STATUS", "DRAFT, PUBLISHED, or ARCHIVED"),
    type: optionalEnum(query.type, contentTypes, "TYPE", "a valid ContentType"),
    language: optionalAdminLanguage(query.language),
    search: optionalString(query.search, 200, "SEARCH")
  },
  query
});

export const createContent = body => {
  const translations = Array.isArray(body.translations) ? body.translations : [];
  if (!translations.length) {
    const message = "translations must contain at least one language entry.";
    throw new HttpError(400, "TRANSLATIONS_REQUIRED", message, [{ field: "translations", message }]);
  }
  const seen = new Set();
  const mapped = translations.map((entry, index) => {
    const translation = translationInput(entry, index);
    if (seen.has(translation.language)) {
      const message = `translations contains language "${translation.language}" more than once.`;
      throw new HttpError(400, "DUPLICATE_TRANSLATION_LANGUAGE", message, [
        { field: "translations", message }
      ]);
    }
    seen.add(translation.language);
    return translation;
  });
  return {
    type: requiredEnum(body.type, contentTypes, "TYPE", "a valid ContentType"),
    locationId: optionalUuid(body.locationId, "locationId"),
    coverStorageKey: optionalString(body.coverStorageKey, 2048, "COVER_STORAGE_KEY"),
    sourceName: optionalString(body.sourceName, 255, "SOURCE_NAME"),
    sourceUrl: optionalUrl(body.sourceUrl, "SOURCE_URL"),
    translations: mapped
  };
};

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const updateContent = body => {
  const fieldChanges = {};
  if (has(body, "type"))
    fieldChanges.type = requiredEnum(body.type, contentTypes, "TYPE", "a valid ContentType");
  if (has(body, "locationId")) fieldChanges.location_id = optionalUuid(body.locationId, "locationId");
  if (has(body, "coverStorageKey"))
    fieldChanges.cover_storage_key = optionalString(body.coverStorageKey, 2048, "COVER_STORAGE_KEY");
  if (has(body, "sourceName")) fieldChanges.source_name = optionalString(body.sourceName, 255, "SOURCE_NAME");
  if (has(body, "sourceUrl")) fieldChanges.source_url = optionalUrl(body.sourceUrl, "SOURCE_URL");

  const translations = Array.isArray(body.translations)
    ? (() => {
        const seen = new Set();
        return body.translations.map((entry, index) => {
          const translation = translationInput(entry, index);
          if (seen.has(translation.language)) {
            const message = `translations contains language "${translation.language}" more than once.`;
            throw new HttpError(400, "DUPLICATE_TRANSLATION_LANGUAGE", message, [
              { field: "translations", message }
            ]);
          }
          seen.add(translation.language);
          return translation;
        });
      })()
    : [];

  if (!Object.keys(fieldChanges).length && !translations.length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return { fieldChanges, translations };
};

export const marketTrendQuery = query => {
  const fromYear = optionalYear(query.fromYear, "FROM_YEAR");
  const toYear = optionalYear(query.toYear, "TO_YEAR");
  if (fromYear !== null && toYear !== null && toYear < fromYear)
    throw new HttpError(400, "INVALID_TO_YEAR", "toYear must be greater than or equal to fromYear.", [
      { field: "toYear", message: "toYear must be greater than or equal to fromYear." }
    ]);
  return {
    locationId: uuid(query.locationId, "locationId"),
    propertyTypeId: optionalUuid(query.propertyTypeId, "propertyTypeId"),
    metric: optionalEnum(query.metric, metrics, "METRIC", "a valid market trend metric"),
    fromYear,
    toYear
  };
};

export const createSeries = body => {
  const locationId = uuid(body.locationId, "locationId");
  const propertyTypeId = optionalUuid(body.propertyTypeId, "propertyTypeId");
  const metric = requiredEnum(body.metric, metrics, "METRIC", "a valid market trend metric");
  const unit = requiredString(body.unit, 1, 50, "UNIT");
  const sourceName = optionalString(body.sourceName, 255, "SOURCE_NAME");
  const sourceUrl = optionalUrl(body.sourceUrl, "SOURCE_URL");
  return { locationId, propertyTypeId, metric, unit, sourceName, sourceUrl };
};

export const updateSeries = body => {
  const changes = {};
  if (has(body, "propertyTypeId")) changes.property_type_id = optionalUuid(body.propertyTypeId, "propertyTypeId");
  if (has(body, "metric")) changes.metric = requiredEnum(body.metric, metrics, "METRIC", "a valid market trend metric");
  if (has(body, "unit")) changes.unit = requiredString(body.unit, 1, 50, "UNIT");
  if (has(body, "sourceName")) changes.source_name = optionalString(body.sourceName, 255, "SOURCE_NAME");
  if (has(body, "sourceUrl")) changes.source_url = optionalUrl(body.sourceUrl, "SOURCE_URL");
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};

export const pointInput = body => ({
  periodDate: periodDate(body.periodDate),
  value: requiredNonNegativeNumber(body.value, "VALUE")
});

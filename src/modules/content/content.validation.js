import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const contentTypes = new Set([
  "NEWS",
  "ARTICLE",
  "EBOOK",
  "LAND_OPPORTUNITY",
  "PROPERTY_LAW",
  "GUIDE"
]);
const languages = new Set(["en", "hi", "mr", "gu", "pa", "te", "ta"]);
const metrics = new Set([
  "ASKING_PRICE",
  "GOVT_RATE",
  "AVG_PRICE_PER_SQFT",
  "AVG_PRICE_PER_ACRE"
]);
const minYear = 1900;
const maxYear = 2100;

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};
const optionalUuid = (value, field) =>
  value === undefined || value === null || value === "" ? null : uuid(value, field);

const requiredString = (value, min, max, field) => {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max)
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be between ${min} and ${max} characters.`
    );
  return text;
};
const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be at most ${max} characters.`);
  return text;
};
const optionalText = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};
const requiredText = (value, field) => {
  const text = String(value ?? "");
  if (!text.trim().length)
    throw new HttpError(400, `INVALID_${field}`, `${field} is required.`);
  return text;
};

const requiredEnum = (value, set, code, label) => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
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
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a valid URL.`);
  }
  return text;
};

export const language = value => {
  const text = String(value ?? "").trim().toLowerCase();
  if (!languages.has(text))
    throw new HttpError(
      400,
      "INVALID_LANGUAGE",
      "language must be one of en, hi, mr, gu, pa, te, ta."
    );
  return text;
};
export const optionalLanguage = value =>
  value === undefined || value === null || value === "" ? "en" : language(value);

const requiredYear = (value, field) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < minYear || num > maxYear)
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be a year between ${minYear} and ${maxYear}.`
    );
  return num;
};
const optionalYear = (value, field) =>
  value === undefined || value === null || value === "" ? null : requiredYear(value, field);

const requiredNonNegativeNumber = (value, field) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be a number >= 0.`);
  return num;
};

const periodDate = value => {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.valueOf()))
    throw new HttpError(400, "INVALID_PERIOD_DATE", "periodDate must be a valid date.");
  return date;
};

const translationInput = (entry, index) => ({
  language: language(entry?.language),
  slug: requiredString(entry?.slug, 1, 255, `TRANSLATIONS_${index}_SLUG`),
  title: requiredString(entry?.title, 1, 500, `TRANSLATIONS_${index}_TITLE`),
  summary: optionalText(entry?.summary, `TRANSLATIONS_${index}_SUMMARY`),
  body: requiredText(entry?.body, `TRANSLATIONS_${index}_BODY`)
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

export const createContent = body => {
  const translations = Array.isArray(body.translations) ? body.translations : [];
  if (!translations.length)
    throw new HttpError(
      400,
      "TRANSLATIONS_REQUIRED",
      "translations must contain at least one language entry."
    );
  const seen = new Set();
  const mapped = translations.map((entry, index) => {
    const translation = translationInput(entry, index);
    if (seen.has(translation.language))
      throw new HttpError(
        400,
        "DUPLICATE_TRANSLATION_LANGUAGE",
        `translations contains language "${translation.language}" more than once.`
      );
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
          if (seen.has(translation.language))
            throw new HttpError(
              400,
              "DUPLICATE_TRANSLATION_LANGUAGE",
              `translations contains language "${translation.language}" more than once.`
            );
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
    throw new HttpError(400, "INVALID_TO_YEAR", "toYear must be greater than or equal to fromYear.");
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

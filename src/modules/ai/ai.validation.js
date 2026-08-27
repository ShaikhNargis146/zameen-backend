import { HttpError } from "../../shared/http.js";
import { parsePagination } from "../../shared/pagination.js";

const contexts = new Set(["GENERAL", "SEARCH", "PROPERTY"]);
const languages = new Set(["en", "hi", "mr", "gu", "pa", "te", "ta"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, field, min, max, required = false) => {
  const result = String(value || "").trim();
  if (!result && !required) return null;
  if (result.length < min || result.length > max)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must contain ${min} to ${max} characters.`
    );
  return result;
};
const uuid = (value, field) => {
  const result = String(value || "").trim();
  if (!uuidPattern.test(result))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return result;
};
const language = value => {
  const result = String(value || "en")
    .trim()
    .toLowerCase();
  if (!languages.has(result))
    throw new HttpError(400, "VALIDATION_ERROR", "language is unsupported.");
  return result;
};

export const search = body => ({
  query: text(body.query, "query", 3, 1000, true),
  language: language(body.language),
  page: Math.min(Math.max(Number(body.page || 1), 1), 10000),
  limit: Math.min(Math.max(Number(body.limit || 20), 1), 50)
});
export const conversation = body => {
  const contextType = String(body.contextType || "")
    .trim()
    .toUpperCase();
  if (!contexts.has(contextType))
    throw new HttpError(400, "VALIDATION_ERROR", "contextType is invalid.");
  const listingId = body.listingId ? uuid(body.listingId, "listingId") : null;
  if (contextType === "PROPERTY" && !listingId)
    throw new HttpError(
      400,
      "LISTING_REQUIRED",
      "listingId is required for PROPERTY context."
    );
  return {
    contextType,
    listingId,
    initialQuery: text(body.initialQuery, "initialQuery", 1, 1000)
  };
};
export const conversationId = value => uuid(value, "conversationId");
export const conversationList = query =>
  parsePagination(query, { maxLimit: 50 });
export const message = body => ({
  content: text(body.content, "content", 1, 4000, true),
  language: language(body.language)
});
export const listingGenerate = body => {
  const highlights =
    body.highlights === undefined || body.highlights === null
      ? []
      : body.highlights;
  if (!Array.isArray(highlights) || highlights.length > 10)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "highlights must contain at most 10 items."
    );
  return {
    propertyId: body.propertyId ? uuid(body.propertyId, "propertyId") : null,
    propertyTypeId: body.propertyTypeId
      ? uuid(body.propertyTypeId, "propertyTypeId")
      : null,
    locationText: text(body.locationText, "locationText", 1, 255),
    areaText: text(body.areaText, "areaText", 1, 100),
    priceText: text(body.priceText, "priceText", 1, 100),
    roadWidthText: text(body.roadWidthText, "roadWidthText", 1, 100),
    highlights: highlights.map((item, index) =>
      text(item, `highlights[${index}]`, 1, 255, true)
    ),
    language: language(body.language)
  };
};

import { HttpError } from "../../shared/http.js";
import { paginationMeta, parsePagination } from "../../shared/pagination.js";
import { signedReadUrl } from "../../utils/storage.js";
import * as repository from "./content.repository.js";

const toLocationSummary = row =>
  row.locationId
    ? {
        id: row.locationId,
        name: row.locationName,
        type: row.locationType,
        parentId: row.locationParentId,
        stateCode: row.locationStateCode,
        latitude: row.locationLatitude === null ? null : Number(row.locationLatitude),
        longitude: row.locationLongitude === null ? null : Number(row.locationLongitude),
        displayPath: row.locationDisplayPath
      }
    : null;

const toContentCard = async row => ({
  id: row.id,
  type: row.type,
  slug: row.slug,
  title: row.title,
  summary: row.summary,
  coverUrl: await signedReadUrl(row.coverStorageKey),
  location: toLocationSummary(row),
  sourceName: row.sourceName,
  sourceUrl: row.sourceUrl,
  publishedAt: row.publishedAt
});

const toContentDetail = async (row, { availableLanguages, includeStatus = false }) => ({
  ...(await toContentCard(row)),
  body: row.body,
  availableLanguages,
  ...(includeStatus ? { status: row.status } : {})
});

const mapReferenceError = error => {
  if (error?.code === "23505")
    throw new HttpError(
      409,
      "SLUG_ALREADY_EXISTS",
      "One of the supplied slugs is already used for that language."
    );
  if (error?.code === "23503")
    throw new HttpError(400, "INVALID_REFERENCE", "locationId does not exist.");
  throw error;
};

export const listContent = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const rows = await repository.listPublished({ ...filters, limit, offset });
  const total = rows[0]?.total || 0;
  return {
    data: await Promise.all(rows.map(toContentCard)),
    meta: paginationMeta({ page, limit, total })
  };
};

export const contentBySlug = async ({ slug, language }) => {
  const row = await repository.findPublishedBySlug({ slug, language });
  if (!row) throw new HttpError(404, "CONTENT_NOT_FOUND", "Content was not found.");
  const translations = await repository.translationsForContent(row.id);
  return toContentDetail(row, { availableLanguages: translations.map(t => t.languageCode) });
};

const pickPrimaryTranslation = translations =>
  translations.find(t => t.languageCode === "en") || translations[0] || null;

const adminContentDetail = async contentId => {
  const item = await repository.findContentById(contentId);
  if (!item) throw new HttpError(404, "CONTENT_NOT_FOUND", "Content was not found.");
  const translations = await repository.translationsForContent(contentId);
  const primary = pickPrimaryTranslation(translations);
  return toContentDetail(
    {
      ...item,
      slug: primary?.slug ?? null,
      title: primary?.title ?? null,
      summary: primary?.summary ?? null,
      body: primary?.body ?? null
    },
    { availableLanguages: translations.map(t => t.languageCode), includeStatus: true }
  );
};

export const createContent = async ({ actorId, input }) => {
  let contentId;
  try {
    contentId = await repository.createContent({ ...input, createdByUserId: actorId });
  } catch (error) {
    mapReferenceError(error);
  }
  return adminContentDetail(contentId);
};

export const updateContent = async ({ contentId, changes }) => {
  const existing = await repository.findContentById(contentId);
  if (!existing) throw new HttpError(404, "CONTENT_NOT_FOUND", "Content was not found.");
  try {
    await repository.updateContent({ id: contentId, ...changes });
  } catch (error) {
    mapReferenceError(error);
  }
  return adminContentDetail(contentId);
};

export const removeContent = async contentId => {
  const result = await repository.softDeleteContent(contentId);
  if (!result) throw new HttpError(404, "CONTENT_NOT_FOUND", "Content was not found.");
};

const contentTransitions = {
  publish: { valid: ["DRAFT", "ARCHIVED"], status: "PUBLISHED", label: "published" },
  archive: { valid: ["DRAFT", "PUBLISHED"], status: "ARCHIVED", label: "archived" }
};

export const transitionContent = async ({ contentId, action }) => {
  const rule = contentTransitions[action];
  const existing = await repository.findContentById(contentId);
  if (!existing) throw new HttpError(404, "CONTENT_NOT_FOUND", "Content was not found.");
  if (!rule.valid.includes(existing.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      `Content cannot be ${rule.label} from its current state.`
    );
  const updated = await repository.setContentStatus({
    id: contentId,
    status: rule.status,
    validStatuses: rule.valid,
    setPublishedAt: action === "publish"
  });
  if (!updated)
    throw new HttpError(
      409,
      "CONTENT_TRANSITION_CONFLICT",
      "Content changed before this transition could be applied."
    );
  return adminContentDetail(contentId);
};

const toSeries = row => ({
  id: row.id,
  location: toLocationSummary(row),
  propertyType: row.propertyTypeId
    ? { id: row.propertyTypeId, code: row.propertyTypeCode, name: row.propertyTypeName }
    : null,
  metric: row.metric,
  unit: row.unit,
  sourceName: row.sourceName,
  sourceUrl: row.sourceUrl,
  points: (row.points || []).map(point => ({
    id: point.id,
    periodDate: point.periodDate,
    value: Number(point.value)
  }))
});

export const listMarketTrends = async filters => (await repository.listSeries(filters)).map(toSeries);

const seriesOrThrow = async seriesId => {
  const row = await repository.findSeriesById(seriesId);
  if (!row) throw new HttpError(404, "SERIES_NOT_FOUND", "Market trend series was not found.");
  return row;
};

const mapSeriesReferenceError = error => {
  if (error?.code === "23505")
    throw new HttpError(
      409,
      "SERIES_ALREADY_EXISTS",
      "A series already exists for this location, property type, metric, and unit."
    );
  if (error?.code === "23503")
    throw new HttpError(400, "INVALID_REFERENCE", "locationId or propertyTypeId does not exist.");
  throw error;
};

export const createSeries = async input => {
  let seriesId;
  try {
    const inserted = await repository.createSeries(input);
    seriesId = inserted.id;
  } catch (error) {
    mapSeriesReferenceError(error);
  }
  return toSeries(await repository.findSeriesById(seriesId));
};

export const updateSeries = async ({ seriesId, changes }) => {
  await seriesOrThrow(seriesId);
  const result = await repository.updateSeries(seriesId, changes);
  if (!result.ok) mapSeriesReferenceError(result.error);
  return toSeries(await repository.findSeriesById(seriesId));
};

export const removeSeries = async seriesId => {
  await seriesOrThrow(seriesId);
  await repository.deleteSeries(seriesId);
};

export const addPoint = async ({ seriesId, input }) => {
  await seriesOrThrow(seriesId);
  const inserted = await repository.addPoint({ seriesId, ...input });
  if (!inserted)
    throw new HttpError(
      409,
      "POINT_ALREADY_EXISTS",
      "A point already exists for this period. Use PATCH to update it."
    );
  return toSeries(await repository.findSeriesById(seriesId));
};

export const updatePoint = async ({ seriesId, pointId, input }) => {
  await seriesOrThrow(seriesId);
  const result = await repository.updatePoint({ seriesId, pointId, ...input });
  if (!result.ok) {
    if (result.error?.code === "23505")
      throw new HttpError(409, "POINT_ALREADY_EXISTS", "A point already exists for this period.");
    throw result.error;
  }
  if (!result.data) throw new HttpError(404, "POINT_NOT_FOUND", "Market trend point was not found.");
  return toSeries(await repository.findSeriesById(seriesId));
};

export const removePoint = async ({ seriesId, pointId }) => {
  await seriesOrThrow(seriesId);
  const deleted = await repository.deletePoint(seriesId, pointId);
  if (!deleted) throw new HttpError(404, "POINT_NOT_FOUND", "Market trend point was not found.");
};

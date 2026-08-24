import { pg, run } from "../../shared/db.js";

const runTx = async fn => {
  const result = await pg.tx(fn);
  if (!result.ok) throw result.error;
  return result.data;
};

const locationFields = `loc.id AS "locationId", loc.name AS "locationName", loc.type AS "locationType", loc.parent_id AS "locationParentId", loc.state_code AS "locationStateCode", CASE WHEN loc.center IS NULL THEN NULL ELSE ST_Y(loc.center::geometry) END AS "locationLatitude", CASE WHEN loc.center IS NULL THEN NULL ELSE ST_X(loc.center::geometry) END AS "locationLongitude", COALESCE((WITH RECURSIVE ancestors AS (SELECT id, parent_id, name, 0 AS depth FROM geo.locations WHERE id = loc.id UNION ALL SELECT parent.id, parent.parent_id, parent.name, ancestors.depth + 1 FROM geo.locations parent JOIN ancestors ON ancestors.parent_id = parent.id) SELECT string_agg(name, ', ' ORDER BY depth DESC) FROM ancestors), loc.name) AS "locationDisplayPath"`;

const contentCardColumns = `ci.id, ci.type, ci.status, ci.cover_storage_key AS "coverStorageKey", ci.source_name AS "sourceName", ci.source_url AS "sourceUrl", ci.published_at AS "publishedAt"`;
const translationColumns = `ct.language_code AS "languageCode", ct.slug, ct.title, ct.summary, ct.body`;

export const listPublished = ({ type, language, locationId, search, limit, offset }) =>
  run(
    "any",
    `SELECT ${contentCardColumns}, ${translationColumns}, ${locationFields}, count(*) OVER()::int AS total
     FROM content.content_items ci
     JOIN content.content_translations ct ON ct.content_id = ci.id AND ct.language_code = $1
     LEFT JOIN geo.locations loc ON loc.id = ci.location_id
     WHERE ci.deleted_at IS NULL AND ci.status = 'PUBLISHED'
       AND ($2::varchar IS NULL OR ci.type = $2)
       AND ($3::uuid IS NULL OR ci.location_id = $3)
       AND ($4::varchar IS NULL OR to_tsvector('simple', ct.title || ' ' || coalesce(ct.summary, '') || ' ' || coalesce(ct.body, '')) @@ plainto_tsquery('simple', $4))
     ORDER BY ci.published_at DESC NULLS LAST, ci.created_at DESC
     LIMIT $5 OFFSET $6`,
    [language, type, locationId, search, limit, offset]
  );

export const findPublishedBySlug = ({ slug, language }) =>
  run(
    "oneOrNone",
    `SELECT ${contentCardColumns}, ${translationColumns}, ${locationFields}
     FROM content.content_items ci
     JOIN content.content_translations ct ON ct.content_id = ci.id AND ct.language_code = $2
     LEFT JOIN geo.locations loc ON loc.id = ci.location_id
     WHERE ci.deleted_at IS NULL AND ci.status = 'PUBLISHED' AND ct.slug = $1`,
    [slug, language]
  );

export const findContentById = id =>
  run(
    "oneOrNone",
    `SELECT ${contentCardColumns}, ${locationFields}
     FROM content.content_items ci
     LEFT JOIN geo.locations loc ON loc.id = ci.location_id
     WHERE ci.id = $1 AND ci.deleted_at IS NULL`,
    [id]
  );

export const translationsForContent = contentId =>
  run(
    "any",
    `SELECT language_code AS "languageCode", slug, title, summary, body
     FROM content.content_translations WHERE content_id = $1 ORDER BY language_code`,
    [contentId]
  );

export const createContent = ({
  type,
  locationId,
  coverStorageKey,
  sourceName,
  sourceUrl,
  createdByUserId,
  translations
}) =>
  runTx(async t => {
    const item = await t.one(
      `INSERT INTO content.content_items (type, location_id, cover_storage_key, source_name, source_url, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [type, locationId, coverStorageKey, sourceName, sourceUrl, createdByUserId]
    );
    for (const translation of translations)
      await t.none(
        `INSERT INTO content.content_translations (content_id, language_code, slug, title, summary, body)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [item.id, translation.language, translation.slug, translation.title, translation.summary, translation.body]
      );
    return item.id;
  });

export const updateContent = ({ id, fieldChanges, translations }) =>
  runTx(async t => {
    if (Object.keys(fieldChanges).length) {
      const columns = Object.keys(fieldChanges);
      const setSql = columns.map((col, i) => `${col} = $${i + 2}`).join(", ");
      await t.none(
        `UPDATE content.content_items SET ${setSql}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`,
        [id, ...columns.map(col => fieldChanges[col])]
      );
    }
    for (const translation of translations)
      await t.none(
        `INSERT INTO content.content_translations (content_id, language_code, slug, title, summary, body, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (content_id, language_code) DO UPDATE SET
           slug = EXCLUDED.slug, title = EXCLUDED.title, summary = EXCLUDED.summary, body = EXCLUDED.body, updated_at = now()`,
        [id, translation.language, translation.slug, translation.title, translation.summary, translation.body]
      );
    return true;
  });

export const softDeleteContent = id =>
  run(
    "oneOrNone",
    `UPDATE content.content_items SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );

export const setContentStatus = ({ id, status, validStatuses, setPublishedAt }) =>
  run(
    "oneOrNone",
    `UPDATE content.content_items SET status = $2, updated_at = now()${
      setPublishedAt ? ", published_at = now()" : ""
    }
     WHERE id = $1 AND deleted_at IS NULL AND status = ANY($3::varchar[]) RETURNING id`,
    [id, status, validStatuses]
  );

const seriesColumns = `mts.id, mts.metric, mts.unit, mts.source_name AS "sourceName", mts.source_url AS "sourceUrl", pt.id AS "propertyTypeId", pt.code AS "propertyTypeCode", pt.name AS "propertyTypeName", ${locationFields}`;
const seriesPointsExpr = extraWhere => `COALESCE((
  SELECT json_agg(json_build_object('id', mtp.id, 'periodDate', mtp.period_date, 'value', mtp.value) ORDER BY mtp.period_date)
  FROM content.market_trend_points mtp
  WHERE mtp.series_id = mts.id${extraWhere}
), '[]'::json) AS points`;

export const listSeries = ({ locationId, propertyTypeId, metric, fromYear, toYear }) =>
  run(
    "any",
    `SELECT ${seriesColumns}, ${seriesPointsExpr(
      " AND ($4::int IS NULL OR EXTRACT(YEAR FROM mtp.period_date) >= $4) AND ($5::int IS NULL OR EXTRACT(YEAR FROM mtp.period_date) <= $5)"
    )}
     FROM content.market_trend_series mts
     JOIN geo.locations loc ON loc.id = mts.location_id
     LEFT JOIN land.property_types pt ON pt.id = mts.property_type_id
     WHERE mts.location_id = $1
       AND ($2::uuid IS NULL OR mts.property_type_id = $2)
       AND ($3::varchar IS NULL OR mts.metric = $3)
     ORDER BY mts.metric, mts.unit`,
    [locationId, propertyTypeId, metric, fromYear, toYear]
  );

export const findSeriesById = id =>
  run(
    "oneOrNone",
    `SELECT ${seriesColumns}, ${seriesPointsExpr("")}
     FROM content.market_trend_series mts
     JOIN geo.locations loc ON loc.id = mts.location_id
     LEFT JOIN land.property_types pt ON pt.id = mts.property_type_id
     WHERE mts.id = $1`,
    [id]
  );

export const createSeries = ({ locationId, propertyTypeId, metric, unit, sourceName, sourceUrl }) =>
  run(
    "one",
    `INSERT INTO content.market_trend_series (location_id, property_type_id, metric, unit, source_name, source_url)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [locationId, propertyTypeId, metric, unit, sourceName, sourceUrl]
  );

export const updateSeries = (id, changes) =>
  pg.updateWhere({
    table: "content.market_trend_series",
    set: { ...changes, updated_at: new Date() },
    where: "id = ${id}",
    params: { id },
    returning: "id"
  });

export const deleteSeries = id =>
  runTx(async t => {
    await t.none(`DELETE FROM content.market_trend_points WHERE series_id = $1`, [id]);
    return t.oneOrNone(`DELETE FROM content.market_trend_series WHERE id = $1 RETURNING id`, [id]);
  });

export const addPoint = ({ seriesId, periodDate, value }) =>
  run(
    "oneOrNone",
    `INSERT INTO content.market_trend_points (series_id, period_date, value)
     VALUES ($1,$2,$3)
     ON CONFLICT (series_id, period_date) DO NOTHING
     RETURNING id`,
    [seriesId, periodDate, value]
  );

export const updatePoint = ({ seriesId, pointId, periodDate, value }) =>
  pg.updateWhere({
    table: "content.market_trend_points",
    set: { period_date: periodDate, value },
    where: "id = ${pointId} AND series_id = ${seriesId}",
    params: { pointId, seriesId },
    returning: "id"
  });

export const deletePoint = (seriesId, pointId) =>
  run(
    "oneOrNone",
    `DELETE FROM content.market_trend_points WHERE id = $1 AND series_id = $2 RETURNING id`,
    [pointId, seriesId]
  );

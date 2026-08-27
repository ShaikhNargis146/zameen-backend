import { pg, run } from "../../shared/db.js";

const conversationColumns = `id, user_id AS "userId", context_type AS "contextType", listing_id AS "listingId", title, guest_token_expires_at AS "guestTokenExpiresAt", created_at AS "createdAt", updated_at AS "updatedAt"`;
export const createConversation = ({
  userId,
  contextType,
  listingId,
  title,
  guestTokenHash,
  guestTokenExpiresAt
}) =>
  pg.one(
    `INSERT INTO ai.conversations (user_id, context_type, listing_id, title, guest_token_hash, guest_token_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${conversationColumns}`,
    [userId, contextType, listingId, title, guestTokenHash, guestTokenExpiresAt]
  );
export const conversation = id =>
  run(
    "oneOrNone",
    `SELECT ${conversationColumns}, guest_token_hash AS "guestTokenHash" FROM ai.conversations WHERE id = $1`,
    [id]
  );
export const addMessage = ({
  conversationId,
  role,
  content,
  metadata = null
}) =>
  pg.one(
    `WITH inserted AS (
       INSERT INTO ai.messages (conversation_id, role, content, metadata)
       VALUES ($1,$2,$3,$4::jsonb)
       RETURNING id, conversation_id, role, content, metadata, created_at
     ), touched AS (
       UPDATE ai.conversations conversation
       SET title = COALESCE(conversation.title, CASE WHEN $2 = 'USER' THEN left($3, 255) END),
           updated_at = now()
       FROM inserted
       WHERE conversation.id = inserted.conversation_id
     )
     SELECT id, role, content, metadata, created_at AS "createdAt" FROM inserted`,
    [conversationId, role, content, metadata ? JSON.stringify(metadata) : null]
  );
export const messages = conversationId =>
  run(
    "any",
    `SELECT id, role, content, metadata, created_at AS "createdAt" FROM ai.messages WHERE conversation_id = $1 ORDER BY created_at, id`,
    [conversationId]
  );
export const conversationsForUser = (userId, { limit, offset }) =>
  run(
    "any",
    `SELECT ${conversationColumns}, count(*) OVER()::int AS total,
       latest.role AS "lastMessageRole", latest.content AS "lastMessageContent",
       latest.created_at AS "lastMessageAt"
     FROM ai.conversations conversation
     LEFT JOIN LATERAL (
       SELECT role, content, created_at
       FROM ai.messages
       WHERE conversation_id = conversation.id
       ORDER BY created_at DESC, id DESC
       LIMIT 1
     ) latest ON true
     WHERE conversation.user_id = $1
     ORDER BY conversation.updated_at DESC, conversation.id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
export const listingContext = id =>
  run(
    "oneOrNone",
    `SELECT p.id AS "propertyId", pt.id AS "propertyTypeId", pt.name AS "propertyType", d.area_value AS "areaValue", au.name AS "areaUnit",
       loc.id AS "locationId", loc.name AS "locationName", l.price_amount_minor AS "priceAmountMinor"
     FROM marketplace.listings l JOIN land.properties p ON p.id = l.property_id
     JOIN land.property_types pt ON pt.id = p.property_type_id
     LEFT JOIN land.property_land_details d ON d.property_id = p.id
     LEFT JOIN land.area_units au ON au.id = d.area_unit_id
     LEFT JOIN land.property_locations pl ON pl.property_id = p.id
     LEFT JOIN geo.locations loc ON loc.id = pl.location_id
     WHERE l.id = $1 AND l.deleted_at IS NULL AND l.status = 'PUBLISHED' AND l.review_status = 'APPROVED'`,
    [id]
  );

export const searchCatalog = () =>
  run(
    "one",
    `SELECT
       (SELECT COALESCE(json_agg(json_build_object('code', code, 'name', name) ORDER BY sort_order, name), '[]'::json)
        FROM land.property_types WHERE is_active) AS "propertyTypes",
       (SELECT COALESCE(json_agg(json_build_object('code', code, 'name', name) ORDER BY name), '[]'::json)
        FROM land.area_units WHERE is_active AND state_location_id IS NULL) AS "areaUnits"`
  );

export const resolveSearchReferences = ({
  locationTerms,
  propertyTypeCodes,
  areaUnitCode
}) =>
  run(
    "one",
    `SELECT
       (SELECT COALESCE(array_agg(DISTINCT id), '{}'::uuid[])
        FROM geo.locations
        WHERE is_active AND lower(name) = ANY($1::text[])) AS "locationIds",
       (SELECT COALESCE(array_agg(id), '{}'::uuid[])
        FROM land.property_types
        WHERE is_active AND upper(code) = ANY($2::text[])) AS "propertyTypeIds",
       (SELECT id FROM land.area_units
        WHERE is_active AND state_location_id IS NULL AND upper(code) = upper($3::varchar)
        ORDER BY id LIMIT 1) AS "areaUnitId"`,
    [
      [
        ...new Set(
          (locationTerms || []).map(term =>
            String(term)
              .trim()
              .toLowerCase()
          )
        )
      ],
      [
        ...new Set(
          (propertyTypeCodes || []).map(code =>
            String(code)
              .trim()
              .toUpperCase()
          )
        )
      ],
      areaUnitCode || null
    ]
  );

export const publishedContentContext = ({ language, locationId, query }) =>
  run(
    "any",
    `SELECT ci.id, ct.slug, ct.title, left(COALESCE(ct.summary, ct.body, ''), 750) AS summary
     FROM content.content_items ci
     JOIN content.content_translations ct ON ct.content_id = ci.id AND ct.language_code = $1
     WHERE ci.deleted_at IS NULL AND ci.status = 'PUBLISHED'
       AND ($2::uuid IS NULL OR ci.location_id IS NULL OR ci.location_id = $2)
     ORDER BY
       CASE WHEN $3::text IS NOT NULL AND to_tsvector('simple', ct.title || ' ' || coalesce(ct.summary, '') || ' ' || coalesce(ct.body, '')) @@ plainto_tsquery('simple', $3) THEN 0 ELSE 1 END,
       ts_rank(to_tsvector('simple', ct.title || ' ' || coalesce(ct.summary, '') || ' ' || coalesce(ct.body, '')), plainto_tsquery('simple', coalesce($3, ''))) DESC,
       CASE WHEN ci.location_id = $2::uuid THEN 0 ELSE 1 END,
       ci.published_at DESC NULLS LAST, ci.created_at DESC
     LIMIT 3`,
    [language, locationId, query || null]
  );

export const marketTrendContext = ({ locationId, propertyTypeId }) =>
  run(
    "any",
    `SELECT mts.id, mts.metric, mts.unit, loc.name AS "locationName", pt.name AS "propertyType",
       mts.source_name AS "sourceName", mts.source_url AS "sourceUrl",
       COALESCE((
         SELECT json_agg(json_build_object('periodDate', point.period_date, 'value', point.value) ORDER BY point.period_date)
         FROM (
           SELECT period_date, value FROM content.market_trend_points
           WHERE series_id = mts.id ORDER BY period_date DESC LIMIT 6
         ) point
       ), '[]'::json) AS points
     FROM content.market_trend_series mts
     JOIN geo.locations loc ON loc.id = mts.location_id
     LEFT JOIN land.property_types pt ON pt.id = mts.property_type_id
     WHERE ($1::uuid IS NOT NULL AND mts.location_id = $1)
       AND ($2::uuid IS NULL OR mts.property_type_id IS NULL OR mts.property_type_id = $2)
     ORDER BY CASE WHEN mts.property_type_id = $2::uuid THEN 0 ELSE 1 END, mts.updated_at DESC
     LIMIT 3`,
    [locationId, propertyTypeId]
  );

export const publishedInvestmentContext = ({ locationId, propertyId, query }) =>
  run(
    "any",
    `SELECT io.id, io.title, io.investment_type AS "investmentType",
       io.minimum_investment_minor AS "minimumInvestmentMinor",
       left(COALESCE(io.description, ''), 750) AS description,
       loc.name AS "locationName", io.published_at AS "publishedAt"
     FROM content.investment_opportunities io
     LEFT JOIN geo.locations loc ON loc.id = io.location_id
     WHERE io.status = 'PUBLISHED'
       AND ($1::uuid IS NULL OR io.location_id IS NULL OR io.location_id = $1 OR io.property_id = $2::uuid)
     ORDER BY
       CASE WHEN $3::text IS NOT NULL AND to_tsvector('simple', io.title || ' ' || coalesce(io.description, '')) @@ plainto_tsquery('simple', $3) THEN 0 ELSE 1 END,
       ts_rank(to_tsvector('simple', io.title || ' ' || coalesce(io.description, '')), plainto_tsquery('simple', coalesce($3, ''))) DESC,
       io.published_at DESC NULLS LAST, io.created_at DESC
     LIMIT 3`,
    [locationId, propertyId, query || null]
  );
export const ownedPropertyContext = (propertyId, userId) =>
  run(
    "oneOrNone",
    `SELECT p.id AS "propertyId", pt.name AS "propertyType", d.area_value AS "areaValue", au.name AS "areaUnit", loc.name AS "locationName"
     FROM land.properties p JOIN land.property_types pt ON pt.id = p.property_type_id
     LEFT JOIN land.property_land_details d ON d.property_id = p.id
     LEFT JOIN land.area_units au ON au.id = d.area_unit_id
     LEFT JOIN land.property_locations pl ON pl.property_id = p.id
     LEFT JOIN geo.locations loc ON loc.id = pl.location_id
     WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.created_by_user_id = $2 OR EXISTS (SELECT 1 FROM account.organization_members om WHERE om.organization_id = p.owner_organization_id AND om.user_id = $2 AND om.status = 'ACTIVE'))`,
    [propertyId, userId]
  );
export const propertyType = id =>
  run(
    "oneOrNone",
    `SELECT name FROM land.property_types WHERE id = $1 AND is_active`,
    [id]
  );

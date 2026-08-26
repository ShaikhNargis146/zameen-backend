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
    `INSERT INTO ai.messages (conversation_id, role, content, metadata) VALUES ($1,$2,$3,$4::jsonb)
     RETURNING id, role, content, metadata, created_at AS "createdAt"`,
    [conversationId, role, content, metadata ? JSON.stringify(metadata) : null]
  );
export const messages = conversationId =>
  run(
    "any",
    `SELECT id, role, content, metadata, created_at AS "createdAt" FROM ai.messages WHERE conversation_id = $1 ORDER BY created_at, id`,
    [conversationId]
  );
export const listingContext = id =>
  run(
    "oneOrNone",
    `SELECT p.id AS "propertyId", pt.name AS "propertyType", d.area_value AS "areaValue", au.name AS "areaUnit",
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

export const publishedContentContext = ({ language, locationId }) =>
  run(
    "any",
    `SELECT ci.id, ct.slug, ct.title, left(COALESCE(ct.summary, ct.body, ''), 750) AS summary
     FROM content.content_items ci
     JOIN content.content_translations ct ON ct.content_id = ci.id AND ct.language_code = $1
     WHERE ci.deleted_at IS NULL AND ci.status = 'PUBLISHED'
       AND ($2::uuid IS NULL OR ci.location_id IS NULL OR ci.location_id = $2)
     ORDER BY CASE WHEN ci.location_id = $2::uuid THEN 0 ELSE 1 END, ci.published_at DESC NULLS LAST, ci.created_at DESC
     LIMIT 3`,
    [language, locationId]
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

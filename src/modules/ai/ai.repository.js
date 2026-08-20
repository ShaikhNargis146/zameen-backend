import { pg, run } from "../../shared/db.js";

const conversationColumns = `id, user_id AS "userId", context_type AS "contextType", listing_id AS "listingId", title, guest_token_expires_at AS "guestTokenExpiresAt", created_at AS "createdAt", updated_at AS "updatedAt"`;
export const createConversation = ({
  userId,
  contextType,
  listingId,
  title,
  guestTokenHash
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
       loc.name AS "locationName", l.price_amount_minor AS "priceAmountMinor"
     FROM marketplace.listings l JOIN land.properties p ON p.id = l.property_id
     JOIN land.property_types pt ON pt.id = p.property_type_id
     LEFT JOIN land.property_land_details d ON d.property_id = p.id
     LEFT JOIN land.area_units au ON au.id = d.area_unit_id
     LEFT JOIN land.property_locations pl ON pl.property_id = p.id
     LEFT JOIN geo.locations loc ON loc.id = pl.location_id
     WHERE l.id = $1 AND l.deleted_at IS NULL AND l.status = 'PUBLISHED' AND l.review_status = 'APPROVED'`,
    [id]
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

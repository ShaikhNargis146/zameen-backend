import { pg, run } from "../../shared/db.js";

export const findOwned = (listingId, userId) =>
  run(
    "oneOrNone",
    `SELECT l.* FROM marketplace.listings l WHERE l.id = $1 AND l.deleted_at IS NULL AND (l.seller_user_id = $2 OR EXISTS (SELECT 1 FROM account.organization_members om WHERE om.organization_id = l.seller_organization_id AND om.user_id = $2 AND om.status = 'ACTIVE'))`,
    [listingId, userId]
  );
export const findAny = listingId =>
  run(
    "oneOrNone",
    `SELECT l.* FROM marketplace.listings l WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [listingId]
  );
export const organizationMembership = (organizationId, userId) =>
  run(
    "oneOrNone",
    `SELECT 1 FROM account.organization_members WHERE organization_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [organizationId, userId]
  );
export const create = input =>
  run(
    "one",
    `INSERT INTO marketplace.listings (listing_code, property_id, created_by_user_id, seller_user_id, seller_organization_id, transaction_type, title, description, canonical_language, price_amount_minor, currency, is_negotiable) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      input.listingCode,
      input.propertyId,
      input.userId,
      input.organizationId,
      input.transactionType,
      input.title,
      input.description,
      input.canonicalLanguage,
      input.priceAmountMinor,
      input.currency,
      input.isNegotiable
    ]
  );
export const summary = id =>
  run(
    "oneOrNone",
    `SELECT l.id, l.listing_code AS "listingCode", l.property_id AS "propertyId", l.transaction_type AS "transactionType", l.title, l.description, l.canonical_language AS "canonicalLanguage", l.price_amount_minor AS "priceAmountMinor", l.currency, l.is_negotiable AS "isNegotiable", l.review_status AS "reviewStatus", l.status, l.rejection_reason AS "rejectionReason", l.submitted_at AS "submittedAt", l.approved_at AS "approvedAt", l.published_at AS "publishedAt", l.expires_at AS "expiresAt", l.sold_at AS "soldAt", l.created_at AS "createdAt", l.updated_at AS "updatedAt" FROM marketplace.listings l WHERE l.id = $1 AND l.deleted_at IS NULL`,
    [id]
  );
export const update = (id, changes) =>
  pg.updateWhere({
    table: "marketplace.listings",
    set: changes,
    where: "id = ${id}",
    params: { id }
  });
export const archive = id =>
  run(
    "none",
    `UPDATE marketplace.listings SET deleted_at = now(), status = 'WITHDRAWN' WHERE id = $1`,
    [id]
  );
export const submit = id =>
  run(
    "none",
    `UPDATE marketplace.listings SET review_status = 'PENDING', status = 'INACTIVE', submitted_at = now(), rejection_reason = NULL WHERE id = $1`,
    [id]
  );
export const transition = ({
  id,
  status,
  setPublishedAt = false,
  setSoldAt = false
}) =>
  run(
    "none",
    `UPDATE marketplace.listings SET status = $2${
      setPublishedAt ? ", published_at = COALESCE(published_at, now())" : ""
    }${setSoldAt ? ", sold_at = now()" : ""} WHERE id = $1`,
    [id, status]
  );
export const audit = ({ actorId, action, listingId, before, after, note }) =>
  run(
    "none",
    `INSERT INTO ops.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1,$2,'marketplace.listings',$3,$4::jsonb,$5::jsonb)`,
    [
      actorId,
      action,
      listingId,
      JSON.stringify(before || {}),
      JSON.stringify({ ...(after || {}), note: note || null })
    ]
  );
export const sellerListings = ({
  userId,
  status,
  reviewStatus,
  search,
  limit,
  offset
}) =>
  run(
    "any",
    `SELECT id, listing_code AS "listingCode", title, status, review_status AS "reviewStatus", price_amount_minor AS "priceAmountMinor", currency, created_at AS "createdAt", updated_at AS "updatedAt", count(*) OVER()::int AS total FROM marketplace.listings l WHERE l.deleted_at IS NULL AND (l.seller_user_id = $1 OR EXISTS (SELECT 1 FROM account.organization_members om WHERE om.organization_id = l.seller_organization_id AND om.user_id = $1 AND om.status = 'ACTIVE')) AND ($2::varchar IS NULL OR l.status = $2) AND ($3::varchar IS NULL OR l.review_status = $3) AND ($4::varchar IS NULL OR l.title ILIKE $4 OR l.listing_code ILIKE $4) ORDER BY l.updated_at DESC LIMIT $5 OFFSET $6`,
    [userId, status, reviewStatus, search ? `%${search}%` : null, limit, offset]
  );
export const publishedDetail = id =>
  run(
    "oneOrNone",
    `SELECT l.id AS "listingId", l.listing_code AS "listingCode", l.title, l.description, l.transaction_type AS "transactionType", l.price_amount_minor AS "priceAmountMinor", l.currency, l.is_negotiable AS "isNegotiable", l.review_status AS "reviewStatus", l.status AS "listingStatus", l.published_at AS "publishedAt", l.expires_at AS "expiresAt", p.id AS "propertyId", p.public_code AS "propertyCode", p.status AS "propertyStatus", pt.id AS "propertyTypeId", pt.code AS "propertyTypeCode", pt.name AS "propertyType", lut.id AS "landUseTypeId", lut.code AS "landUseTypeCode", lut.name AS "landUseType", d.area_value AS "areaValue", au.code AS "areaUnit", d.area_sqft AS "areaSqft", d.frontage_m AS "frontageM", d.road_width_m AS "roadWidthM", d.facing, d.is_corner_plot AS "isCornerPlot", loc.id AS "locationId", loc.name AS "locationName", loc.type AS "locationType", loc.state_code AS "locationStateCode", pc.code AS pincode, pl.landmark, pl.location_precision AS "locationPrecision", pl.show_exact_location AS "showExactLocation", CASE WHEN pl.show_exact_location THEN ST_Y(pl.coordinates::geometry) END AS latitude, CASE WHEN pl.show_exact_location THEN ST_X(pl.coordinates::geometry) END AS longitude, seller.id AS "sellerId", seller.display_name AS "sellerDisplayName", organization.id AS "organizationId", organization.name AS "organizationName", organization.type AS "organizationType", s.readiness_score AS "scannerScore", s.missing_items AS "scannerMissingItems" FROM marketplace.listings l JOIN land.properties p ON p.id = l.property_id AND p.deleted_at IS NULL JOIN land.property_types pt ON pt.id = p.property_type_id LEFT JOIN land.land_use_types lut ON lut.id = p.land_use_type_id LEFT JOIN land.property_land_details d ON d.property_id = p.id LEFT JOIN land.area_units au ON au.id = d.area_unit_id LEFT JOIN land.property_locations pl ON pl.property_id = p.id LEFT JOIN geo.locations loc ON loc.id = pl.location_id LEFT JOIN geo.postal_codes pc ON pc.id = pl.postal_code_id LEFT JOIN auth.users seller ON seller.id = l.seller_user_id LEFT JOIN account.organizations organization ON organization.id = l.seller_organization_id AND organization.deleted_at IS NULL LEFT JOIN marketplace.v_listing_scanner s ON s.listing_id = l.id WHERE l.id = $1 AND l.status = 'PUBLISHED' AND l.review_status = 'APPROVED' AND l.deleted_at IS NULL`,
    [id]
  );
export const media = propertyId =>
  run(
    "any",
    `SELECT id, media_type AS "mediaType", storage_key AS "storageKey", thumbnail_storage_key AS "thumbnailStorageKey", mime_type AS "mimeType", caption, sort_order AS "sortOrder", is_cover AS "isCover" FROM land.property_media WHERE property_id = $1 AND deleted_at IS NULL ORDER BY sort_order`,
    [propertyId]
  );
export const amenities = propertyId =>
  run(
    "any",
    `SELECT a.code, a.name, a.category, pa.value_text AS "valueText" FROM land.property_amenities pa JOIN land.amenities a ON a.id = pa.amenity_id WHERE pa.property_id = $1 ORDER BY a.sort_order`,
    [propertyId]
  );
export const parcelSummary = propertyId =>
  run(
    "any",
    `SELECT pit.code AS type, pit.name AS label, pi.identifier_value AS value FROM land.property_parcel_identifiers pi JOIN land.parcel_identifier_types pit ON pit.id = pi.identifier_type_id WHERE pi.property_id = $1 ORDER BY pit.sort_order, pit.name`,
    [propertyId]
  );
export const verification = propertyId =>
  run(
    "any",
    `SELECT check_type AS "checkType", status, reviewed_at AS "reviewedAt", notes AS "publicNote", updated_at AS "updatedAt" FROM land.property_verification_checks WHERE property_id = $1 ORDER BY check_type`,
    [propertyId]
  );
export const passport = propertyId =>
  run(
    "oneOrNone",
    `SELECT property_id AS "propertyId", public_code AS "passportCode", completeness_percent AS "propertyCompletionPercent", verification_checks AS "verificationChecks", document_count AS "documentCount", last_updated AS "lastUpdated" FROM land.v_land_passports WHERE property_id = $1`,
    [propertyId]
  );
export const promotions = id =>
  run(
    "any",
    `SELECT promotion_type AS "promotionType" FROM marketplace.listing_promotions WHERE listing_id = $1 AND status = 'ACTIVE' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())`,
    [id]
  );
export const isFavorite = (listingId, userId) =>
  run(
    "one",
    `SELECT EXISTS (SELECT 1 FROM marketplace.favorites WHERE listing_id = $1 AND user_id = $2) AS "isFavorite"`,
    [listingId, userId]
  );
export const adminListings = ({
  reviewStatus,
  status,
  search,
  limit,
  offset
}) =>
  run(
    "any",
    `SELECT l.id, l.listing_code AS "listingCode", l.title, l.review_status AS "reviewStatus", l.status, l.submitted_at AS "submittedAt", l.created_at AS "createdAt", count(*) OVER()::int AS total
     FROM marketplace.listings l
     LEFT JOIN auth.users seller ON seller.id = l.seller_user_id
     WHERE l.deleted_at IS NULL AND ($1::varchar IS NULL OR l.review_status = $1)
       AND ($2::varchar IS NULL OR l.status = $2)
       AND ($3::varchar IS NULL OR l.title ILIKE $3 OR l.listing_code ILIKE $3 OR seller.display_name ILIKE $3)
     ORDER BY l.submitted_at NULLS LAST, l.created_at DESC LIMIT $4 OFFSET $5`,
    [reviewStatus, status, search ? `%${search}%` : null, limit, offset]
  );
export const adminListing = id => summary(id);
export const approve = ({ id, expiresAt }) =>
  run(
    "oneOrNone",
    `UPDATE marketplace.listings SET review_status = 'APPROVED', status = 'INACTIVE', approved_at = now(), expires_at = COALESCE($2, expires_at), rejection_reason = NULL WHERE id = $1 AND review_status = 'PENDING' AND deleted_at IS NULL RETURNING id`,
    [id, expiresAt]
  );
export const reject = (id, reason) =>
  run(
    "oneOrNone",
    `UPDATE marketplace.listings SET review_status = 'REJECTED', status = 'INACTIVE', rejection_reason = $2 WHERE id = $1 AND review_status = 'PENDING' AND deleted_at IS NULL RETURNING id`,
    [id, reason]
  );
export const suspend = id =>
  run(
    "oneOrNone",
    `UPDATE marketplace.listings SET status = 'SUSPENDED' WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );

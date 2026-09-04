import { run } from "./db.js";
import { optionalSignedReadUrl } from "../utils/storage.js";

const cardSql = `
SELECT listing.id AS "listingId", listing.listing_code AS "listingCode", listing.property_id AS "propertyId", listing.title,
  listing.transaction_type AS "transactionType", listing.price_amount_minor AS "priceAmountMinor", listing.published_at AS "publishedAt",
  pt.id AS "propertyTypeId", pt.code AS "propertyTypeCode", pt.name AS "propertyTypeName",
  pld.area_value AS "areaValue",
  au.id AS "areaUnitId", au.code AS "areaUnitCode", au.name AS "areaUnitName",
  loc.id AS "locationId", loc.name AS "locationName", loc.type AS "locationType",
  loc.parent_id AS "locationParentId", loc.state_code AS "locationStateCode",
  CASE WHEN loc.center IS NULL THEN NULL ELSE ST_Y(loc.center::geometry) END AS "locationLatitude",
  CASE WHEN loc.center IS NULL THEN NULL ELSE ST_X(loc.center::geometry) END AS "locationLongitude",
  media.storage_key AS "thumbnailStorageKey",
  EXISTS (
    SELECT 1 FROM marketplace.listing_promotions promo
    WHERE promo.listing_id = listing.id AND promo.promotion_type = 'PREMIUM' AND promo.status = 'ACTIVE'
      AND promo.starts_at <= now() AND (promo.ends_at IS NULL OR promo.ends_at > now())
  ) AS "isPremium",
  (
    SELECT 'Verified' FROM marketplace.listing_promotions promo
    WHERE promo.listing_id = listing.id AND promo.promotion_type = 'VERIFIED_BADGE' AND promo.status = 'ACTIVE'
      AND promo.starts_at <= now() AND (promo.ends_at IS NULL OR promo.ends_at > now())
    LIMIT 1
  ) AS "verificationLabel",
  ($2::uuid IS NOT NULL AND EXISTS (
    SELECT 1 FROM marketplace.favorites fav WHERE fav.listing_id = listing.id AND fav.user_id = $2::uuid
  )) AS "isFavorite"
FROM marketplace.listings listing
JOIN land.properties property ON property.id = listing.property_id
JOIN land.property_types pt ON pt.id = property.property_type_id
LEFT JOIN land.property_land_details pld ON pld.property_id = property.id
LEFT JOIN land.area_units au ON au.id = pld.area_unit_id
LEFT JOIN land.property_locations ploc ON ploc.property_id = property.id
LEFT JOIN geo.locations loc ON loc.id = ploc.location_id
LEFT JOIN land.property_media media ON media.property_id = property.id AND media.is_cover = true AND media.deleted_at IS NULL
WHERE listing.id = ANY($1::uuid[]) AND listing.deleted_at IS NULL
  AND ($3::boolean IS NOT TRUE OR (listing.status = 'PUBLISHED' AND listing.review_status = 'APPROVED'
    AND (listing.expires_at IS NULL OR listing.expires_at > now())))
`;

const roundTo = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const round = value => Math.round(value * 100) / 100;
export const formatPriceDisplay = amountMinor => {
  if (amountMinor === null || amountMinor === undefined)
    return "Price on request";
  const rupees = Number(amountMinor) / 100;
  if (rupees >= 10000000)
    return `₹${round(rupees / 10000000).toLocaleString("en-IN", {
      maximumFractionDigits: 2
    })} Cr`;
  if (rupees >= 100000)
    return `₹${round(rupees / 100000).toLocaleString("en-IN", {
      maximumFractionDigits: 2
    })} L`;
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
};
const toCard = async row => ({
  listingId: row.listingId,
  listingCode: row.listingCode,
  propertyId: row.propertyId,
  title: row.title,
  propertyType: {
    id: row.propertyTypeId,
    code: row.propertyTypeCode,
    name: row.propertyTypeName
  },
  transactionType: row.transactionType,
  priceAmountMinor:
    row.priceAmountMinor === null ? null : Number(row.priceAmountMinor),
  priceDisplay: formatPriceDisplay(row.priceAmountMinor),
  areaValue: row.areaValue === null ? null : Number(row.areaValue),
  areaUnit: row.areaUnitId
    ? { id: row.areaUnitId, code: row.areaUnitCode, name: row.areaUnitName }
    : null,
  location: row.locationId
    ? {
        id: row.locationId,
        name: row.locationName,
        type: row.locationType,
        parentId: row.locationParentId,
        stateCode: row.locationStateCode,
        displayPath: row.locationName
      }
    : null,
  thumbnailUrl: await optionalSignedReadUrl(row.thumbnailStorageKey),
  isPremium: row.isPremium,
  verificationLabel: row.verificationLabel,
  publishedAt: row.publishedAt,
  isFavorite: row.isFavorite
});

/**
 * Builds ListingCard projections for the given listing IDs, preserving the
 * caller's order (used for favorites/recently-viewed MRU ordering).
 *
 * requirePublished defaults to true (public surfaces only ever show live
 * listings). Pass false for owner-facing CRM views (enquiries, site visits)
 * where the listing may since have been paused/withdrawn but the record it
 * relates to still needs to render.
 */
export const listingCardsByIds = async (
  listingIds,
  actorId = null,
  { requirePublished = true } = {}
) => {
  const ids = [...new Set(listingIds)].filter(Boolean);
  if (!ids.length) return [];
  const rows = await run("any", cardSql, [ids, actorId, requirePublished]);
  const cards = await Promise.all(rows.map(toCard));
  const byId = new Map(cards.map(card => [card.listingId, card]));
  return listingIds.map(id => byId.get(id)).filter(Boolean);
};

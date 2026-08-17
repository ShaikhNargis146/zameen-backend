import { run } from "./db.js";
import { signedReadUrl } from "../utils/storage.js";

const cardsQuery = `
WITH RECURSIVE location_ancestors AS (
  SELECT g.id AS location_id, g.id, g.parent_id, g.name, g.type, 0 AS depth
  FROM geo.locations g
  WHERE g.id IN (
    SELECT ploc.location_id
    FROM land.property_locations ploc
    JOIN marketplace.listings l ON l.property_id = ploc.property_id
    WHERE l.id = ANY($1::uuid[])
  )
  UNION ALL
  SELECT la.location_id, parent.id, parent.parent_id, parent.name, parent.type, la.depth + 1
  FROM location_ancestors la
  JOIN geo.locations parent ON parent.id = la.parent_id
),
location_display AS (
  SELECT location_id, string_agg(name, ', ' ORDER BY depth) AS display_path
  FROM location_ancestors
  WHERE type <> 'COUNTRY'
  GROUP BY location_id
)
SELECT
  listing.id AS "listingId",
  listing.listing_code AS "listingCode",
  listing.property_id AS "propertyId",
  listing.title,
  listing.transaction_type AS "transactionType",
  listing.price_amount_minor AS "priceAmountMinor",
  listing.published_at AS "publishedAt",
  pld.area_value AS "areaValue",
  pt.id AS "propertyTypeId", pt.code AS "propertyTypeCode", pt.name AS "propertyTypeName",
  au.id AS "areaUnitId", au.code AS "areaUnitCode", au.name AS "areaUnitName",
  loc.id AS "locationId", loc.name AS "locationName", loc.type AS "locationType",
  loc.parent_id AS "locationParentId", loc.state_code AS "locationStateCode",
  CASE WHEN loc.center IS NULL THEN NULL ELSE ST_Y(loc.center::geometry) END AS "locationLatitude",
  CASE WHEN loc.center IS NULL THEN NULL ELSE ST_X(loc.center::geometry) END AS "locationLongitude",
  disp.display_path AS "locationDisplayPath",
  media.storage_key AS "thumbnailUrl",
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
LEFT JOIN location_display disp ON disp.location_id = loc.id
LEFT JOIN land.property_media media ON media.property_id = property.id AND media.is_cover = true AND media.deleted_at IS NULL
WHERE listing.id = ANY($1::uuid[]) AND listing.status = 'PUBLISHED' AND listing.review_status = 'APPROVED' AND listing.deleted_at IS NULL
`;

const roundTo = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const formatPriceDisplay = amountMinor => {
  if (amountMinor === null || amountMinor === undefined) return "Price on request";
  const rupees = Number(amountMinor) / 100;
  if (rupees >= 1e7)
    return `₹${roundTo(rupees / 1e7, 2).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
  if (rupees >= 1e5)
    return `₹${roundTo(rupees / 1e5, 2).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
};

const toListingCard = async row => ({
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
  priceAmountMinor: row.priceAmountMinor === null ? null : Number(row.priceAmountMinor),
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
        latitude: row.locationLatitude === null ? null : Number(row.locationLatitude),
        longitude: row.locationLongitude === null ? null : Number(row.locationLongitude),
        displayPath: row.locationDisplayPath || row.locationName
      }
    : null,
  thumbnailUrl: await signedReadUrl(row.thumbnailUrl),
  isPremium: row.isPremium,
  verificationLabel: row.verificationLabel || null,
  publishedAt: row.publishedAt,
  isFavorite: row.isFavorite
});

/**
 * Builds ListingCard projections for the given listing IDs, preserving the
 * caller's order (used for favorites/recently-viewed MRU ordering).
 */
export const listingCardsByIds = async (listingIds, actorId = null) => {
  const ids = [...new Set(listingIds)].filter(Boolean);
  if (!ids.length) return [];
  const rows = await run("any", cardsQuery, [ids, actorId]);
  const cards = await Promise.all(rows.map(toListingCard));
  const byId = new Map(cards.map(card => [card.listingId, card]));
  return listingIds.map(id => byId.get(id)).filter(Boolean);
};

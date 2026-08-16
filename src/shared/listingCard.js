import { run } from "./db.js";
import { signedReadUrl } from "../utils/storage.js";

const cardSql = `
SELECT l.id AS "listingId", l.listing_code AS "listingCode", l.property_id AS "propertyId", l.title,
  l.transaction_type AS "transactionType", l.price_amount_minor AS "priceAmountMinor", l.published_at AS "publishedAt",
  pt.id AS "propertyTypeId", pt.code AS "propertyTypeCode", pt.name AS "propertyTypeName",
  details.area_value AS "areaValue", unit.id AS "areaUnitId", unit.code AS "areaUnitCode", unit.name AS "areaUnitName",
  location.id AS "locationId", location.name AS "locationName", location.type AS "locationType", location.parent_id AS "locationParentId", location.state_code AS "locationStateCode",
  cover.storage_key AS "thumbnailStorageKey",
  EXISTS (SELECT 1 FROM marketplace.listing_promotions promotion WHERE promotion.listing_id = l.id AND promotion.promotion_type = 'PREMIUM' AND promotion.status = 'ACTIVE' AND promotion.starts_at <= now() AND (promotion.ends_at IS NULL OR promotion.ends_at > now())) AS "isPremium",
  ($2::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM marketplace.favorites favorite WHERE favorite.listing_id = l.id AND favorite.user_id = $2::uuid)) AS "isFavorite"
FROM marketplace.listings l
JOIN land.properties p ON p.id = l.property_id AND p.deleted_at IS NULL
JOIN land.property_types pt ON pt.id = p.property_type_id
LEFT JOIN land.property_land_details details ON details.property_id = p.id
LEFT JOIN land.area_units unit ON unit.id = details.area_unit_id
LEFT JOIN land.property_locations property_location ON property_location.property_id = p.id
LEFT JOIN geo.locations location ON location.id = property_location.location_id
LEFT JOIN land.property_media cover ON cover.property_id = p.id AND cover.is_cover AND cover.deleted_at IS NULL
WHERE l.id = ANY($1::uuid[]) AND l.deleted_at IS NULL
  AND ($3::boolean OR (l.status = 'PUBLISHED' AND l.review_status = 'APPROVED'))`;

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
  thumbnailUrl: await signedReadUrl(row.thumbnailStorageKey),
  isPremium: row.isPremium,
  verificationLabel: null,
  publishedAt: row.publishedAt,
  isFavorite: row.isFavorite
});

export const listingCardsByIds = async (
  listingIds,
  actorId = null,
  includeUnpublished = false
) => {
  const ids = [...new Set(listingIds)].filter(Boolean);
  if (!ids.length) return [];
  const rows = await run("any", cardSql, [ids, actorId, includeUnpublished]);
  const cards = await Promise.all(rows.map(toCard));
  const byId = new Map(cards.map(card => [card.listingId, card]));
  return listingIds.map(id => byId.get(id)).filter(Boolean);
};

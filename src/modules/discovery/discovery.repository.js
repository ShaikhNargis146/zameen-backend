import { run } from "../../shared/db.js";

const orderBy = Object.freeze({
  RELEVANCE: "is_premium DESC, is_verified DESC, published_at DESC, id",
  NEWEST: "published_at DESC, id",
  PRICE_ASC: "price_amount_minor ASC NULLS LAST, published_at DESC",
  PRICE_DESC: "price_amount_minor DESC NULLS LAST, published_at DESC",
  AREA_ASC: "area_sqft ASC NULLS LAST, published_at DESC",
  AREA_DESC: "area_sqft DESC NULLS LAST, published_at DESC"
});

const filteredListingWhere = `
  WHERE l.deleted_at IS NULL AND l.status = 'PUBLISHED' AND l.review_status = 'APPROVED'
    AND (cardinality($1::uuid[]) = 0 OR pl.location_id = ANY($1::uuid[]))
    AND (cardinality($2::uuid[]) = 0 OR p.property_type_id = ANY($2::uuid[]))
    AND (cardinality($3::varchar[]) = 0 OR l.transaction_type = ANY($3::varchar[]))
    AND ($4::bigint IS NULL OR l.price_amount_minor >= $4)
    AND ($5::bigint IS NULL OR l.price_amount_minor <= $5)
    AND ($6::numeric IS NULL OR d.area_sqft >= $6 * requested_unit.sqft_multiplier)
    AND ($8::numeric IS NULL OR d.area_sqft <= $8 * requested_unit.sqft_multiplier)
    AND ($9::boolean = false OR EXISTS (SELECT 1 FROM land.property_verification_checks verification WHERE verification.property_id = p.id AND verification.status = 'VERIFIED'))
    AND ($10::numeric IS NULL OR d.road_width_m >= $10)
    AND (cardinality($11::varchar[]) = 0 OR d.facing = ANY($11::varchar[]))
    AND ($12::boolean IS NULL OR d.is_corner_plot = $12)
    AND (cardinality($13::varchar[]) = 0 OR
      ('OWNER' = ANY($13::varchar[]) AND l.seller_organization_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM auth.user_roles ur JOIN auth.roles role ON role.id = ur.role_id
        WHERE ur.user_id = l.seller_user_id AND role.code IN ('BROKER', 'DEVELOPER')
      )) OR
      ('BROKER' = ANY($13::varchar[]) AND (
        EXISTS (SELECT 1 FROM auth.user_roles ur JOIN auth.roles role ON role.id = ur.role_id WHERE ur.user_id = l.seller_user_id AND role.code = 'BROKER') OR
        EXISTS (SELECT 1 FROM account.organizations organization WHERE organization.id = l.seller_organization_id AND organization.type IN ('BROKERAGE', 'AGENCY'))
      )) OR
      ('DEVELOPER' = ANY($13::varchar[]) AND (
        EXISTS (SELECT 1 FROM auth.user_roles ur JOIN auth.roles role ON role.id = ur.role_id WHERE ur.user_id = l.seller_user_id AND role.code = 'DEVELOPER') OR
        EXISTS (SELECT 1 FROM account.organizations organization WHERE organization.id = l.seller_organization_id AND organization.type = 'DEVELOPER')
      ))
    )`;

const filteredListingSql = `
  FROM marketplace.listings l
  JOIN land.properties p ON p.id = l.property_id AND p.deleted_at IS NULL
  LEFT JOIN land.property_locations pl ON pl.property_id = p.id
  LEFT JOIN land.property_land_details d ON d.property_id = p.id
  LEFT JOIN land.area_units requested_unit ON requested_unit.id = $7::uuid
  ${filteredListingWhere}`;

const params = filters => [
  filters.locationIds,
  filters.propertyTypeIds,
  filters.transactionTypes,
  filters.minPriceMinor,
  filters.maxPriceMinor,
  filters.minArea,
  filters.areaUnitId,
  filters.maxArea,
  filters.verifiedOnly,
  filters.minRoadWidthM,
  filters.facing,
  filters.cornerPlot,
  filters.sellerType
];

export const searchIds = filters =>
  run(
    "any",
    `SELECT id AS "listingId", count(*) OVER()::int AS total FROM (
       SELECT DISTINCT l.id, l.published_at, l.price_amount_minor, d.area_sqft,
         EXISTS (SELECT 1 FROM marketplace.listing_promotions promotion WHERE promotion.listing_id = l.id AND promotion.status = 'ACTIVE' AND promotion.starts_at <= now() AND (promotion.ends_at IS NULL OR promotion.ends_at > now())) AS is_premium,
         EXISTS (SELECT 1 FROM land.property_verification_checks verification WHERE verification.property_id = p.id AND verification.status = 'VERIFIED') AS is_verified
       ${filteredListingSql}
     ) filtered ORDER BY ${orderBy[filters.sort]} LIMIT $14 OFFSET $15`,
    [...params(filters), filters.limit, filters.offset]
  );

export const suggestions = ({ q, limit }) =>
  run(
    "any",
    `SELECT 'LOCATION' AS type, l.name AS label, l.id::text AS value,
       COALESCE(parent.name, l.state_code) AS "secondaryLabel"
     FROM geo.locations l LEFT JOIN geo.locations parent ON parent.id = l.parent_id
     WHERE l.is_active AND l.name ILIKE $1 ESCAPE '\\'
     UNION ALL
     SELECT 'PROPERTY_TYPE' AS type, pt.name AS label, pt.id::text AS value, NULL AS "secondaryLabel"
     FROM land.property_types pt WHERE pt.is_active AND pt.name ILIKE $1 ESCAPE '\\'
     ORDER BY type, label LIMIT $2`,
    [`%${q.replace(/[\\%_]/g, "\\\\$&")}%`, limit]
  );

export const mapPins = filters =>
  run(
    "any",
    `SELECT DISTINCT l.id AS "listingId",
       CASE WHEN pl.show_exact_location THEN ST_Y(pl.coordinates::geometry) ELSE ST_Y(loc.center::geometry) END AS latitude,
       CASE WHEN pl.show_exact_location THEN ST_X(pl.coordinates::geometry) ELSE ST_X(loc.center::geometry) END AS longitude,
       l.price_amount_minor AS "priceAmountMinor", d.area_value AS "areaValue", au.code AS "areaUnitCode",
       l.published_at AS "publishedAt",
       pt.name AS "propertyTypeName", media.storage_key AS "thumbnailStorageKey",
       EXISTS (SELECT 1 FROM marketplace.listing_promotions promo WHERE promo.listing_id = l.id AND promo.promotion_type = 'PREMIUM' AND promo.status = 'ACTIVE' AND promo.starts_at <= now() AND (promo.ends_at IS NULL OR promo.ends_at > now())) AS "isPremium"
     FROM marketplace.listings l
     JOIN land.properties p ON p.id = l.property_id AND p.deleted_at IS NULL
     JOIN land.property_types pt ON pt.id = p.property_type_id
     LEFT JOIN land.property_locations pl ON pl.property_id = p.id
     LEFT JOIN geo.locations loc ON loc.id = pl.location_id
     LEFT JOIN land.property_land_details d ON d.property_id = p.id
     LEFT JOIN land.area_units requested_unit ON requested_unit.id = $7::uuid
     LEFT JOIN land.area_units au ON au.id = d.area_unit_id
     LEFT JOIN land.property_media media ON media.property_id = p.id AND media.is_cover AND media.deleted_at IS NULL
     ${filteredListingWhere}
     AND (CASE WHEN pl.show_exact_location THEN ST_Y(pl.coordinates::geometry) ELSE ST_Y(loc.center::geometry) END) BETWEEN $14 AND $15
     AND (CASE WHEN pl.show_exact_location THEN ST_X(pl.coordinates::geometry) ELSE ST_X(loc.center::geometry) END) BETWEEN $16 AND $17
     ORDER BY "publishedAt" DESC LIMIT $18`,
    [
      ...params(filters),
      filters.south,
      filters.north,
      filters.west,
      filters.east,
      filters.maxPins
    ]
  );

export const similarIds = (listingId, limit) =>
  run(
    "any",
    `SELECT candidate.id AS "listingId" FROM marketplace.listings target
     JOIN land.properties target_property ON target_property.id = target.property_id
     JOIN marketplace.listings candidate ON candidate.id <> target.id AND candidate.status = 'PUBLISHED' AND candidate.review_status = 'APPROVED' AND candidate.deleted_at IS NULL
     JOIN land.properties candidate_property ON candidate_property.id = candidate.property_id AND candidate_property.deleted_at IS NULL
     WHERE target.id = $1 AND target.status = 'PUBLISHED' AND target.review_status = 'APPROVED' AND target.deleted_at IS NULL
       AND candidate_property.property_type_id = target_property.property_type_id
     ORDER BY ABS(COALESCE(candidate.price_amount_minor, 0) - COALESCE(target.price_amount_minor, 0)), candidate.published_at DESC
     LIMIT $2`,
    [listingId, limit]
  );

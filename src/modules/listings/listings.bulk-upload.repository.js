import { pg, run } from "../../shared/db.js";

export const activeMasters = () =>
  Promise.all([
    run("any", `SELECT id, code FROM land.property_types WHERE is_active = true`),
    run("any", `SELECT id, code FROM land.land_use_types WHERE is_active = true`),
    run("any", `SELECT id, code FROM land.ownership_types WHERE is_active = true`),
    run(
      "any",
      `SELECT u.id, u.code, state.state_code AS "stateCode", u.sqft_multiplier AS "sqftMultiplier" FROM land.area_units u LEFT JOIN geo.locations state ON state.id = u.state_location_id WHERE u.is_active = true`
    ),
    run("any", `SELECT id, code FROM land.amenities WHERE is_active = true`)
  ]).then(([propertyTypes, landUseTypes, ownershipTypes, areaUnits, amenities]) => ({
    propertyTypes,
    landUseTypes,
    ownershipTypes,
    areaUnits,
    amenities
  }));

export const locationsByIds = ids =>
  ids.length
    ? run(
        "any",
        `SELECT id, state_code AS "stateCode" FROM geo.locations WHERE id = ANY($1::uuid[]) AND is_active = true`,
        [ids]
      )
    : Promise.resolve([]);

export const postalCodesByCodes = codes =>
  codes.length
    ? run("any", `SELECT id, code FROM geo.postal_codes WHERE code = ANY($1::varchar[])`, [
        codes
      ])
    : Promise.resolve([]);

// This endpoint is admin-only: the caller is doing back-office data entry
// on behalf of whichever organisation owns each row, not just their own —
// so this checks the organisation exists at all, not that the admin
// belongs to it (compare the seller-facing activeOrganizationMembership
// checks in properties.repository.js / listings.repository.js).
export const existingOrganizationIds = ids =>
  (ids.length
    ? run(
        "any",
        `SELECT id FROM account.organizations WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [ids]
      )
    : Promise.resolve([])
  ).then(rows => new Set(rows.map(row => row.id)));

const listingCode = randomUUID =>
  `ZMN-L-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
const propertyCode = randomUUID =>
  `ZMN-P-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

/**
 * Creates the property, its land details, location, amenities, and a draft
 * listing for one validated row, all inside a single transaction so a row
 * either lands completely or leaves no partial data behind.
 */
export const createPropertyListing = async ({ actorId, row, randomUUID }) => {
  const result = await pg.tx(async transaction => {
    // This endpoint is admin-only, so every property it creates is recorded
    // with source='ADMIN' rather than the 'USER' default used by a seller's
    // own POST /properties — it's operational/back-office data entry, not a
    // seller self-service listing.
    const property = await transaction.one(
      `INSERT INTO land.properties (public_code, property_type_id, land_use_type_id, ownership_type_id, created_by_user_id, owner_organization_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,'ADMIN') RETURNING id`,
      [
        propertyCode(randomUUID),
        row.propertyTypeId,
        row.landUseTypeId,
        row.ownershipTypeId,
        actorId,
        row.organizationId
      ]
    );
    await transaction.none(
      `INSERT INTO land.property_land_details (property_id, area_value, area_unit_id, area_sqft, length_value, width_value, dimension_unit, frontage_m, road_width_m, road_type, facing, open_sides, is_corner_plot, has_boundary_wall, terrain, road_access_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        property.id,
        row.areaValue,
        row.areaUnitId,
        row.areaSqft,
        row.lengthValue,
        row.widthValue,
        row.dimensionUnit,
        row.frontageM,
        row.roadWidthM,
        row.roadType,
        row.facing,
        row.openSides,
        row.isCornerPlot,
        row.hasBoundaryWall,
        row.terrain,
        row.roadAccessType
      ]
    );
    await transaction.none(
      `INSERT INTO land.property_locations (property_id, location_id, postal_code_id, address_line, landmark, coordinates, location_precision, show_exact_location)
       VALUES ($1,$2,$3,$4,$5,CASE WHEN $6::numeric IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography END,$8,$9)`,
      [
        property.id,
        row.locationId,
        row.postalCodeId,
        row.addressLine,
        row.landmark,
        row.latitude,
        row.longitude,
        row.locationPrecision,
        row.showExactLocation
      ]
    );
    for (const amenity of row.amenities)
      await transaction.none(
        `INSERT INTO land.property_amenities (property_id, amenity_id, value_text) VALUES ($1,$2,$3)`,
        [property.id, amenity.amenityId, amenity.valueText]
      );
    const listing = await transaction.one(
      `INSERT INTO marketplace.listings (listing_code, property_id, created_by_user_id, seller_user_id, seller_organization_id, transaction_type, title, description, canonical_language, price_amount_minor, currency, is_negotiable)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,'INR',$10) RETURNING id, listing_code AS "listingCode"`,
      [
        listingCode(randomUUID),
        property.id,
        actorId,
        row.organizationId,
        row.transactionType,
        row.title,
        row.description,
        row.canonicalLanguage,
        row.priceAmountMinor,
        row.isNegotiable
      ]
    );
    return {
      propertyId: property.id,
      listingId: listing.id,
      listingCode: listing.listingCode
    };
  });
  if (!result.ok) throw result.error;
  return result.data;
};

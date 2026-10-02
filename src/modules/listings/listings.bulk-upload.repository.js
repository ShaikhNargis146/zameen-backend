import { pg, run } from "../../shared/db.js";

export const activeMasters = () =>
  Promise.all([
    run(
      "any",
      `SELECT id, code FROM land.property_types WHERE is_active = true`
    ),
    run(
      "any",
      `SELECT id, code FROM land.land_use_types WHERE is_active = true`
    ),
    run(
      "any",
      `SELECT id, code FROM land.ownership_types WHERE is_active = true`
    ),
    run(
      "any",
      `SELECT u.id, u.code, state.state_code AS "stateCode", u.sqft_multiplier AS "sqftMultiplier" FROM land.area_units u LEFT JOIN geo.locations state ON state.id = u.state_location_id WHERE u.is_active = true`
    ),
    run("any", `SELECT id, code FROM land.amenities WHERE is_active = true`)
  ]).then(
    ([propertyTypes, landUseTypes, ownershipTypes, areaUnits, amenities]) => ({
      propertyTypes,
      landUseTypes,
      ownershipTypes,
      areaUnits,
      amenities
    })
  );

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
    ? run(
        "any",
        `SELECT id, code FROM geo.postal_codes WHERE code = ANY($1::varchar[])`,
        [codes]
      )
    : Promise.resolve([]);

// Used to resolve a row's location when locationId is left blank: a pincode
// maps to one or more localities/villages via geo.postal_code_locations, so
// every candidate (with coordinates, for nearest-point disambiguation) is
// returned and the service picks among them.
export const locationCandidatesByPincodes = codes =>
  codes.length
    ? run(
        "any",
        `SELECT p.code, l.id, l.state_code AS "stateCode",
                CASE WHEN l.center IS NULL THEN NULL ELSE ST_Y(l.center::geometry) END AS latitude,
                CASE WHEN l.center IS NULL THEN NULL ELSE ST_X(l.center::geometry) END AS longitude
         FROM geo.postal_codes p
         JOIN geo.postal_code_locations pl ON pl.postal_code_id = p.id
         JOIN geo.locations l ON l.id = pl.location_id AND l.is_active = true
         WHERE p.code = ANY($1::varchar[])`,
        [codes]
      )
    : Promise.resolve([]);

// This endpoint is admin-only back-office data entry on behalf of whichever
// seller owns each row, so the seller is identified by phone number rather
// than requiring the admin to already know (or be a member of) their
// internal user/organization ids.
export const usersByPhones = phones =>
  phones.length
    ? run(
        "any",
        `SELECT id, phone_e164 AS "phoneE164" FROM auth.users WHERE phone_e164 = ANY($1::varchar[]) AND deleted_at IS NULL`,
        [phones]
      )
    : Promise.resolve([]);

// Only active memberships in a non-deleted organization count. The service
// attributes a listing to an organization only when a seller has exactly
// one such membership — this just returns the raw rows for it to count.
export const activeOrganizationMembershipsByUserIds = userIds =>
  userIds.length
    ? run(
        "any",
        `SELECT om.user_id AS "userId", om.organization_id AS "organizationId"
         FROM account.organization_members om
         JOIN account.organizations o ON o.id = om.organization_id AND o.deleted_at IS NULL
         WHERE om.user_id = ANY($1::uuid[]) AND om.status = 'ACTIVE'`,
        [userIds]
      )
    : Promise.resolve([]);

const listingCode = randomUUID =>
  `ZMN-L-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .toUpperCase()}`;
const propertyCode = randomUUID =>
  `ZMN-P-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .toUpperCase()}`;

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
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'INR',$11) RETURNING id, listing_code AS "listingCode"`,
      [
        listingCode(randomUUID),
        property.id,
        actorId,
        row.sellerUserId,
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

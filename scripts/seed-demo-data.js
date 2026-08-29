import "../src/config/env.js";
import db from "../src/config/postgres.config.js";

const demoEmail = "demo.listings@zameens.invalid";
const expiresAt = () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const samples = [
  ["ZMN-DEMO-MUM-001", "ZMN-DEMO-L-001", "Corner Residential Plot near Bandra West", "Mumbai", "Bandra West", "bandra-west", "400050", 19.0596, 72.8295, "RESIDENTIAL_PLOT", "RESIDENTIAL", 2400, "SQFT", 2400, 8250000000, "W", 9, true, true, true],
  ["ZMN-DEMO-MUM-002", "ZMN-DEMO-L-002", "Commercial Land Parcel in Wadala", "Mumbai", "Wadala", "wadala", "400031", 19.0178, 72.8581, "COMMERCIAL_LAND", "COMMERCIAL", 1800, "SQFT", 1800, 6200000000, "E", 12, false, false, true],
  ["ZMN-DEMO-MUM-003", "ZMN-DEMO-L-003", "Freehold Residential Plot in Borivali West", "Mumbai", "Borivali West", "borivali-west", "400092", 19.2307, 72.8567, "RESIDENTIAL_PLOT", "RESIDENTIAL", 1050, "SQFT", 1050, 3200000000, "N", 7.5, false, false, false],
  ["ZMN-DEMO-NM-001", "ZMN-DEMO-L-004", "Verified Residential Plot in Kharghar", "Navi Mumbai", "Kharghar", "kharghar", "410210", 19.033, 73.065, "RESIDENTIAL_PLOT", "RESIDENTIAL", 1200, "SQFT", 1200, 2750000000, "NE", 9, true, true, true],
  ["ZMN-DEMO-NM-002", "ZMN-DEMO-L-005", "Industrial Land near Taloja MIDC", "Navi Mumbai", "Taloja", "taloja", "410208", 19.006, 73.107, "INDUSTRIAL_LAND", "INDUSTRIAL", 2.5, "ACRE", 108900, 4800000000, "S", 18, false, false, true],
  ["ZMN-DEMO-NM-003", "ZMN-DEMO-L-006", "Residential Plot with Sea-side Connectivity in Ulwe", "Navi Mumbai", "Ulwe", "ulwe", "410206", 18.9947, 73.0184, "RESIDENTIAL_PLOT", "RESIDENTIAL", 1000, "SQFT", 1000, 1850000000, "NW", 9, false, false, false]
].map(
  ([
    code,
    listingCode,
    title,
    city,
    locality,
    localitySlug,
    pincode,
    latitude,
    longitude,
    propertyTypeCode,
    landUseCode,
    areaValue,
    areaUnitCode,
    areaSqft,
    priceAmountMinor,
    facing,
    roadWidthM,
    isCornerPlot,
    premium,
    verified
  ]) => ({
    code,
    listingCode,
    title,
    city,
    locality,
    localitySlug,
    pincode,
    latitude,
    longitude,
    propertyTypeCode,
    landUseCode,
    areaValue,
    areaUnitCode,
    areaSqft,
    priceAmountMinor,
    facing,
    roadWidthM,
    isCornerPlot,
    premium,
    verified
  })
);

const ensureLocation = async (transaction, input) => {
  const existing = await transaction.oneOrNone(
    `SELECT id FROM geo.locations
     WHERE type = $1 AND slug = $2 AND parent_id IS NOT DISTINCT FROM $3`,
    [input.type, input.slug, input.parentId || null]
  );
  if (existing) return existing.id;
  const result = await transaction.one(
    `INSERT INTO geo.locations (parent_id, type, name, slug, state_code, center)
     VALUES ($1,$2,$3,$4,$5,
       CASE WHEN $6::numeric IS NULL THEN NULL
       ELSE ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography END)
     RETURNING id`,
    [
      input.parentId || null,
      input.type,
      input.name,
      input.slug,
      input.stateCode || null,
      input.latitude || null,
      input.longitude || null
    ]
  );
  return result.id;
};

const masterId = (transaction, table, code) =>
  transaction.one(`SELECT id FROM ${table} WHERE code = $1 AND is_active`, [code]);

const ensurePromotion = async (transaction, listingId, promotionType) => {
  const promotion = await transaction.oneOrNone(
    `SELECT id FROM marketplace.listing_promotions
     WHERE listing_id = $1 AND promotion_type = $2
     ORDER BY created_at DESC LIMIT 1`,
    [listingId, promotionType]
  );
  if (promotion)
    return transaction.none(
      `UPDATE marketplace.listing_promotions
       SET status = 'ACTIVE', starts_at = now(), ends_at = $2 WHERE id = $1`,
      [promotion.id, expiresAt()]
    );
  return transaction.none(
    `INSERT INTO marketplace.listing_promotions
     (listing_id, promotion_type, starts_at, ends_at, status)
     VALUES ($1,$2,now(),$3,'ACTIVE')`,
    [listingId, promotionType, expiresAt()]
  );
};

if (process.env.NODE_ENV === "production")
  throw new Error("Demo data seeding is disabled when NODE_ENV is production.");
if (process.env.DEMO_DATA !== "true")
  throw new Error("Run this development-only script through npm run demo:seed.");

try {
  const result = await db.tx(async transaction => {
    const user =
      (await transaction.oneOrNone(
        `SELECT id FROM auth.users WHERE email = $1 AND deleted_at IS NULL`,
        [demoEmail]
      )) ||
      (await transaction.one(
        `INSERT INTO auth.users (email, display_name, preferred_language)
         VALUES ($1,'Zameens Demo Seller','en') RETURNING id`,
        [demoEmail]
      ));
    await transaction.none(
      `INSERT INTO auth.user_roles (user_id, role_id)
       SELECT $1, id FROM auth.roles WHERE code IN ('BUYER','SELLER')
       ON CONFLICT DO NOTHING`,
      [user.id]
    );

    const indiaId = await ensureLocation(transaction, {
      type: "COUNTRY",
      name: "India",
      slug: "india"
    });
    const maharashtraId = await ensureLocation(transaction, {
      parentId: indiaId,
      type: "STATE",
      name: "Maharashtra",
      slug: "maharashtra",
      stateCode: "MH"
    });
    const cityIds = {
      Mumbai: await ensureLocation(transaction, {
        parentId: maharashtraId,
        type: "CITY",
        name: "Mumbai",
        slug: "mumbai",
        stateCode: "MH",
        latitude: 19.076,
        longitude: 72.8777
      }),
      "Navi Mumbai": await ensureLocation(transaction, {
        parentId: maharashtraId,
        type: "CITY",
        name: "Navi Mumbai",
        slug: "navi-mumbai",
        stateCode: "MH",
        latitude: 19.033,
        longitude: 73.0297
      })
    };
    const [ownership, ...masters] = await Promise.all([
      masterId(transaction, "land.ownership_types", "FREEHOLD"),
      ...[...new Set(samples.map(item => item.propertyTypeCode))].map(code =>
        masterId(transaction, "land.property_types", code)
      ),
      ...[...new Set(samples.map(item => item.landUseCode))].map(code =>
        masterId(transaction, "land.land_use_types", code)
      ),
      ...[...new Set(samples.map(item => item.areaUnitCode))].map(code =>
        masterId(transaction, "land.area_units", code)
      )
    ]);
    const typeCodes = [...new Set(samples.map(item => item.propertyTypeCode))];
    const landUseCodes = [...new Set(samples.map(item => item.landUseCode))];
    const areaUnitCodes = [...new Set(samples.map(item => item.areaUnitCode))];
    const propertyTypes = new Map(typeCodes.map((code, index) => [code, masters[index].id]));
    const landUses = new Map(
      landUseCodes.map((code, index) => [code, masters[typeCodes.length + index].id])
    );
    const areaUnits = new Map(
      areaUnitCodes.map((code, index) => [
        code,
        masters[typeCodes.length + landUseCodes.length + index].id
      ])
    );
    const listings = [];

    for (const sample of samples) {
      const localityId = await ensureLocation(transaction, {
        parentId: cityIds[sample.city],
        type: "LOCALITY",
        name: sample.locality,
        slug: sample.localitySlug,
        stateCode: "MH",
        latitude: sample.latitude,
        longitude: sample.longitude
      });
      const postalCode = await transaction.one(
        `INSERT INTO geo.postal_codes (code, state_code) VALUES ($1,'MH')
         ON CONFLICT (code) DO UPDATE SET
           state_code = COALESCE(geo.postal_codes.state_code, EXCLUDED.state_code)
         RETURNING id`,
        [sample.pincode]
      );
      const property = await transaction.one(
        `INSERT INTO land.properties
         (public_code, property_type_id, land_use_type_id, ownership_type_id, created_by_user_id, source, status)
         VALUES ($1,$2,$3,$4,$5,'ADMIN','ACTIVE')
         ON CONFLICT (public_code) DO UPDATE SET
           property_type_id = EXCLUDED.property_type_id,
           land_use_type_id = EXCLUDED.land_use_type_id,
           ownership_type_id = EXCLUDED.ownership_type_id, status = 'ACTIVE', deleted_at = NULL
         RETURNING id`,
        [
          sample.code,
          propertyTypes.get(sample.propertyTypeCode),
          landUses.get(sample.landUseCode),
          ownership.id,
          user.id
        ]
      );
      await transaction.none(
        `INSERT INTO land.property_land_details
         (property_id, area_value, area_unit_id, area_sqft, frontage_m, road_width_m,
          road_type, facing, open_sides, is_corner_plot, has_boundary_wall, terrain, road_access_type)
         VALUES ($1,$2,$3,$4,12,$5,'PUCCA',$6,2,$7,true,'FLAT','DIRECT')
         ON CONFLICT (property_id) DO UPDATE SET
           area_value = EXCLUDED.area_value, area_unit_id = EXCLUDED.area_unit_id,
           area_sqft = EXCLUDED.area_sqft, frontage_m = EXCLUDED.frontage_m,
           road_width_m = EXCLUDED.road_width_m, road_type = EXCLUDED.road_type,
           facing = EXCLUDED.facing, open_sides = EXCLUDED.open_sides,
           is_corner_plot = EXCLUDED.is_corner_plot,
           has_boundary_wall = EXCLUDED.has_boundary_wall, terrain = EXCLUDED.terrain,
           road_access_type = EXCLUDED.road_access_type`,
        [
          property.id,
          sample.areaValue,
          areaUnits.get(sample.areaUnitCode),
          sample.areaSqft,
          sample.roadWidthM,
          sample.facing,
          sample.isCornerPlot
        ]
      );
      await transaction.none(
        `INSERT INTO land.property_locations
         (property_id, location_id, postal_code_id, address_line, landmark, coordinates,
          location_precision, show_exact_location)
         VALUES ($1,$2,$3,$4,'Development sample location',
          ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,'APPROXIMATE',false)
         ON CONFLICT (property_id) DO UPDATE SET
           location_id = EXCLUDED.location_id, postal_code_id = EXCLUDED.postal_code_id,
           address_line = EXCLUDED.address_line, landmark = EXCLUDED.landmark,
           coordinates = EXCLUDED.coordinates, location_precision = EXCLUDED.location_precision,
           show_exact_location = EXCLUDED.show_exact_location`,
        [
          property.id,
          localityId,
          postalCode.id,
          `${sample.locality}, ${sample.city}`,
          sample.latitude,
          sample.longitude
        ]
      );
      await transaction.none(
        `INSERT INTO land.property_verification_checks
         (property_id, check_type, status, requested_by_user_id, requested_at, reviewed_by_user_id, reviewed_at, notes)
         VALUES ($1,'LAND_DETAILS','VERIFIED',$2,now(),$2,now(),'Development sample verification')
         ON CONFLICT (property_id, check_type) DO UPDATE SET
           status = 'VERIFIED', reviewed_by_user_id = EXCLUDED.reviewed_by_user_id,
           reviewed_at = EXCLUDED.reviewed_at, notes = EXCLUDED.notes`,
        [property.id, user.id]
      );
      const listing = await transaction.one(
        `INSERT INTO marketplace.listings
         (listing_code, property_id, created_by_user_id, seller_user_id, transaction_type,
          title, description, price_amount_minor, currency, is_negotiable,
          review_status, status, submitted_at, approved_at, published_at, expires_at)
         VALUES ($1,$2,$3,$3,'SALE',$4,$5,$6,'INR',true,'APPROVED','PUBLISHED',now(),now(),now(),$7)
         ON CONFLICT (listing_code) DO UPDATE SET
           property_id = EXCLUDED.property_id, title = EXCLUDED.title,
           description = EXCLUDED.description, price_amount_minor = EXCLUDED.price_amount_minor,
           review_status = 'APPROVED', status = 'PUBLISHED', deleted_at = NULL,
           approved_at = now(), published_at = now(), expires_at = EXCLUDED.expires_at
         RETURNING id, listing_code AS "listingCode", title`,
        [
          sample.listingCode,
          property.id,
          user.id,
          sample.title,
          `Development sample: ${sample.title} in ${sample.locality}, ${sample.city}.`,
          sample.priceAmountMinor,
          expiresAt()
        ]
      );
      if (sample.premium) await ensurePromotion(transaction, listing.id, "PREMIUM");
      if (sample.verified)
        await ensurePromotion(transaction, listing.id, "VERIFIED_BADGE");
      listings.push({
        listingId: listing.id,
        listingCode: listing.listingCode,
        title: listing.title,
        location: sample.locality
      });
    }
    return { demoSellerEmail: demoEmail, listings };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.$pool.end();
}

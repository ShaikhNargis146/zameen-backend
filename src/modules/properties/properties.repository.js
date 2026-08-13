import { pg, run } from "../../shared/db.js";

const propertySummarySql = `SELECT p.id, p.public_code AS "publicCode", jsonb_build_object('id', pt.id, 'code', pt.code, 'name', pt.name, 'sortOrder', pt.sort_order) AS "propertyType", CASE WHEN lut.id IS NULL THEN NULL ELSE jsonb_build_object('id', lut.id, 'code', lut.code, 'name', lut.name, 'sortOrder', lut.sort_order) END AS "landUseType", CASE WHEN ot.id IS NULL THEN NULL ELSE jsonb_build_object('id', ot.id, 'code', ot.code, 'name', ot.name, 'sortOrder', ot.sort_order) END AS "ownershipType", p.owner_organization_id AS "organizationId", p.source, p.status, COALESCE(scanner.readiness_score, 0)::int AS "completionPercent", p.created_at AS "createdAt", p.updated_at AS "updatedAt" FROM land.properties p JOIN land.property_types pt ON pt.id = p.property_type_id LEFT JOIN land.land_use_types lut ON lut.id = p.land_use_type_id LEFT JOIN land.ownership_types ot ON ot.id = p.ownership_type_id LEFT JOIN land.v_property_scanner scanner ON scanner.property_id = p.id`;

export const findOwned = (propertyId, userId) =>
  run(
    "oneOrNone",
    `SELECT p.* FROM land.properties p WHERE p.id = $1 AND p.deleted_at IS NULL AND (p.created_by_user_id = $2 OR EXISTS (SELECT 1 FROM account.organization_members om WHERE om.organization_id = p.owner_organization_id AND om.user_id = $2 AND om.status = 'ACTIVE'))`,
    [propertyId, userId]
  );
export const findPublic = propertyId =>
  run(
    "oneOrNone",
    `SELECT p.* FROM land.properties p WHERE p.id = $1 AND p.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM marketplace.listings l WHERE l.property_id = p.id AND l.deleted_at IS NULL AND l.status = 'PUBLISHED' AND l.review_status = 'APPROVED')`,
    [propertyId]
  );
export const activeOrganizationMembership = (organizationId, userId) =>
  run(
    "oneOrNone",
    `SELECT 1 FROM account.organization_members WHERE organization_id = $1 AND user_id = $2 AND status = 'ACTIVE'`,
    [organizationId, userId]
  );
export const createProperty = input =>
  run(
    "one",
    `INSERT INTO land.properties (public_code, property_type_id, land_use_type_id, ownership_type_id, created_by_user_id, owner_organization_id, source) VALUES ($1,$2,$3,$4,$5,$6,'USER') RETURNING id`,
    [
      input.publicCode,
      input.propertyTypeId,
      input.landUseTypeId,
      input.ownershipTypeId,
      input.userId,
      input.organizationId
    ]
  );
export const summary = propertyId =>
  run(
    "oneOrNone",
    `${propertySummarySql} WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [propertyId]
  );
export const summaries = propertyIds =>
  run(
    "any",
    `${propertySummarySql} WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL ORDER BY array_position($1::uuid[], p.id)`,
    [propertyIds]
  );
export const ownedIds = ({ userId, status, search, limit, offset }) =>
  run(
    "any",
    `SELECT DISTINCT p.id FROM land.properties p LEFT JOIN land.property_locations pl ON pl.property_id = p.id LEFT JOIN geo.locations l ON l.id = pl.location_id WHERE p.deleted_at IS NULL AND (p.created_by_user_id = $1 OR EXISTS (SELECT 1 FROM account.organization_members om WHERE om.organization_id = p.owner_organization_id AND om.user_id = $1 AND om.status = 'ACTIVE')) AND ($2::varchar IS NULL OR p.status = $2) AND ($3::varchar IS NULL OR p.public_code ILIKE $3 OR l.name ILIKE $3) ORDER BY p.updated_at DESC LIMIT $4 OFFSET $5`,
    [userId, status, search, limit, offset]
  );
export const countOwned = ({ userId, status, search }) =>
  run(
    "one",
    `SELECT count(DISTINCT p.id)::int AS total FROM land.properties p LEFT JOIN land.property_locations pl ON pl.property_id = p.id LEFT JOIN geo.locations l ON l.id = pl.location_id WHERE p.deleted_at IS NULL AND (p.created_by_user_id = $1 OR EXISTS (SELECT 1 FROM account.organization_members om WHERE om.organization_id = p.owner_organization_id AND om.user_id = $1 AND om.status = 'ACTIVE')) AND ($2::varchar IS NULL OR p.status = $2) AND ($3::varchar IS NULL OR p.public_code ILIKE $3 OR l.name ILIKE $3)`,
    [userId, status, search]
  );
export const archive = propertyId =>
  run(
    "none",
    `UPDATE land.properties SET deleted_at = now(), status = 'ARCHIVED' WHERE id = $1 AND deleted_at IS NULL`,
    [propertyId]
  );
export const update = (propertyId, changes) =>
  pg.updateWhere({
    table: "land.properties",
    set: changes,
    where: "id = ${id}",
    params: { id: propertyId }
  });
export const landDetails = propertyId =>
  run(
    "oneOrNone",
    `SELECT d.property_id AS "propertyId", d.area_value AS "areaValue", d.area_unit_id AS "areaUnitId", u.code AS "areaUnitCode", d.area_sqft AS "normalizedAreaSqft", d.length_value AS "lengthValue", d.width_value AS "widthValue", d.dimension_unit_id AS "dimensionUnitId", du.code AS "dimensionUnitCode", d.frontage_m AS "frontageM", d.road_width_m AS "roadWidthM", d.road_type_id AS "roadTypeId", rt.code AS "roadTypeCode", d.facing, d.open_sides AS "openSides", d.is_corner_plot AS "isCornerPlot", d.has_boundary_wall AS "hasBoundaryWall", d.terrain, d.road_access_type AS "roadAccessType" FROM land.property_land_details d JOIN land.area_units u ON u.id = d.area_unit_id LEFT JOIN land.area_units du ON du.id = d.dimension_unit_id LEFT JOIN land.road_types rt ON rt.id = d.road_type_id WHERE d.property_id = $1`,
    [propertyId]
  );
export const areaUnit = id =>
  run(
    "oneOrNone",
    `SELECT sqft_multiplier FROM land.area_units WHERE id = $1 AND is_active = true`,
    [id]
  );
export const saveLandDetails = input =>
  run(
    "none",
    `INSERT INTO land.property_land_details (property_id, area_value, area_unit_id, area_sqft, length_value, width_value, dimension_unit_id, frontage_m, road_width_m, road_type_id, facing, open_sides, is_corner_plot, has_boundary_wall, terrain, road_access_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (property_id) DO UPDATE SET area_value=EXCLUDED.area_value, area_unit_id=EXCLUDED.area_unit_id, area_sqft=EXCLUDED.area_sqft, length_value=EXCLUDED.length_value, width_value=EXCLUDED.width_value, dimension_unit_id=EXCLUDED.dimension_unit_id, frontage_m=EXCLUDED.frontage_m, road_width_m=EXCLUDED.road_width_m, road_type_id=EXCLUDED.road_type_id, facing=EXCLUDED.facing, open_sides=EXCLUDED.open_sides, is_corner_plot=EXCLUDED.is_corner_plot, has_boundary_wall=EXCLUDED.has_boundary_wall, terrain=EXCLUDED.terrain, road_access_type=EXCLUDED.road_access_type`,
    [
      input.propertyId,
      input.areaValue,
      input.areaUnitId,
      input.areaSqft,
      input.lengthValue,
      input.widthValue,
      input.dimensionUnitId,
      input.frontageM,
      input.roadWidthM,
      input.roadTypeId,
      input.facing,
      input.openSides,
      input.isCornerPlot,
      input.hasBoundaryWall,
      input.terrain,
      input.roadAccessType
    ]
  );
export const location = propertyId =>
  run(
    "oneOrNone",
    `SELECT pl.property_id AS "propertyId", pl.location_id AS "locationId", jsonb_build_object('id', l.id, 'name', l.name, 'type', l.type, 'parentId', l.parent_id, 'stateCode', l.state_code) AS location, pc.code AS pincode, pl.address_line AS "addressLine", pl.landmark, CASE WHEN pl.coordinates IS NULL THEN NULL ELSE ST_Y(pl.coordinates::geometry) END AS latitude, CASE WHEN pl.coordinates IS NULL THEN NULL ELSE ST_X(pl.coordinates::geometry) END AS longitude, pl.location_precision AS "locationPrecision", pl.show_exact_location AS "showExactLocation" FROM land.property_locations pl JOIN geo.locations l ON l.id = pl.location_id LEFT JOIN geo.postal_codes pc ON pc.id = pl.postal_code_id WHERE pl.property_id = $1`,
    [propertyId]
  );
export const postalCode = code =>
  run("oneOrNone", `SELECT id FROM geo.postal_codes WHERE code = $1`, [code]);
export const saveLocation = input =>
  run(
    "none",
    `INSERT INTO land.property_locations (property_id, location_id, postal_code_id, address_line, landmark, coordinates, location_precision, show_exact_location) VALUES ($1,$2,$3,$4,$5,CASE WHEN $6::numeric IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography END,$8,$9) ON CONFLICT (property_id) DO UPDATE SET location_id=EXCLUDED.location_id, postal_code_id=EXCLUDED.postal_code_id, address_line=EXCLUDED.address_line, landmark=EXCLUDED.landmark, coordinates=EXCLUDED.coordinates, location_precision=EXCLUDED.location_precision, show_exact_location=EXCLUDED.show_exact_location`,
    [
      input.propertyId,
      input.locationId,
      input.postalCodeId,
      input.addressLine,
      input.landmark,
      input.latitude,
      input.longitude,
      input.locationPrecision,
      input.showExactLocation
    ]
  );
export const amenities = propertyId =>
  run(
    "any",
    `SELECT pa.amenity_id AS "amenityId", a.code, a.name, a.category, pa.value_text AS "valueText" FROM land.property_amenities pa JOIN land.amenities a ON a.id = pa.amenity_id WHERE pa.property_id = $1 ORDER BY a.sort_order, a.name`,
    [propertyId]
  );
export const replaceAmenities = async (propertyId, amenities) => {
  const result = await pg.tx(async transaction => {
    await transaction.none(
      `DELETE FROM land.property_amenities WHERE property_id = $1`,
      [propertyId]
    );
    for (const item of amenities)
      await transaction.none(
        `INSERT INTO land.property_amenities (property_id, amenity_id, value_text) VALUES ($1,$2,$3)`,
        [propertyId, item.amenityId, item.valueText]
      );
  });
  if (!result.ok) throw result.error;
};
export const identifiers = propertyId =>
  run(
    "any",
    `SELECT pi.id, pit.code AS type, pit.name AS label, pi.identifier_value AS value FROM land.property_parcel_identifiers pi JOIN land.parcel_identifier_types pit ON pit.id = pi.identifier_type_id WHERE pi.property_id = $1 ORDER BY pit.sort_order, pit.name`,
    [propertyId]
  );
export const replaceIdentifiers = async (propertyId, identifiers) => {
  const result = await pg.tx(async transaction => {
    await transaction.none(
      `DELETE FROM land.property_parcel_identifiers WHERE property_id = $1`,
      [propertyId]
    );
    for (const item of identifiers) {
      const type = await transaction.oneOrNone(
        `SELECT id FROM land.parcel_identifier_types WHERE code = $1 AND is_active = true`,
        [item.type]
      );
      if (!type)
        throw new Error(
          `Parcel identifier type ${item.type} is not configured.`
        );
      await transaction.none(
        `INSERT INTO land.property_parcel_identifiers (property_id, identifier_type_id, identifier_value) VALUES ($1,$2,$3)`,
        [propertyId, type.id, item.value]
      );
    }
  });
  if (!result.ok) throw result.error;
};
export const requestVerification = async ({
  propertyId,
  userId,
  checkTypes
}) => {
  const result = await pg.tx(async transaction => {
    for (const checkType of checkTypes)
      await transaction.none(
        `INSERT INTO land.property_verification_checks (property_id, check_type, status, requested_by_user_id, requested_at) VALUES ($1,$2,'PENDING',$3,now()) ON CONFLICT (property_id, check_type) DO UPDATE SET status = CASE WHEN property_verification_checks.status = 'VERIFIED' THEN 'VERIFIED' ELSE 'PENDING' END, requested_by_user_id = EXCLUDED.requested_by_user_id, requested_at = EXCLUDED.requested_at`,
        [propertyId, checkType, userId]
      );
  });
  if (!result.ok) throw result.error;
};
export const verification = propertyId =>
  run(
    "any",
    `SELECT id, check_type AS "checkType", status, requested_at AS "requestedAt", reviewed_at AS "reviewedAt", notes AS "publicNote" FROM land.property_verification_checks WHERE property_id = $1 ORDER BY check_type`,
    [propertyId]
  );
export const scanner = propertyId =>
  run(
    "oneOrNone",
    `SELECT property_id AS "propertyId", readiness_score AS "readinessScore", missing_items AS "missingItems" FROM land.v_property_scanner WHERE property_id = $1`,
    [propertyId]
  );
export const passport = propertyId =>
  run(
    "oneOrNone",
    `SELECT passport.property_id AS "propertyId", passport.public_code AS "publicCode", passport.completeness_percent AS "completenessPercent", passport.verification_checks AS "verificationChecks", passport.document_count AS "documentCount", passport.last_updated AS "lastUpdated",
       (SELECT count(*) FROM land.property_documents document WHERE document.property_id = passport.property_id AND document.deleted_at IS NULL AND document.verification_status = 'VERIFIED')::int AS "verifiedDocumentCount",
       (SELECT max(reviewed_at) FROM land.property_verification_checks check_item WHERE check_item.property_id = passport.property_id AND check_item.status = 'VERIFIED') AS "lastVerifiedAt"
     FROM land.v_land_passports passport WHERE passport.property_id = $1`,
    [propertyId]
  );
export const media = propertyId =>
  run(
    "any",
    `SELECT id, media_type AS "mediaType", storage_key AS "storageKey", thumbnail_storage_key AS "thumbnailStorageKey", mime_type AS "mimeType", sort_order AS "sortOrder", is_cover AS "isCover", caption FROM land.property_media WHERE property_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at`,
    [propertyId]
  );
export const mediaForProperty = (propertyId, mediaId) =>
  run(
    "oneOrNone",
    `SELECT id FROM land.property_media WHERE id = $1 AND property_id = $2 AND deleted_at IS NULL`,
    [mediaId, propertyId]
  );
export const createMedia = input =>
  run(
    "one",
    `INSERT INTO land.property_media (property_id, media_type, storage_key, mime_type, sort_order, is_cover, caption, uploaded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      input.propertyId,
      input.mediaType,
      input.storageKey,
      input.mimeType,
      input.sortOrder,
      input.isCover,
      input.caption,
      input.userId
    ]
  );
export const updateMedia = (mediaId, changes) =>
  pg.updateWhere({
    table: "land.property_media",
    set: changes,
    where: "id = ${id} AND deleted_at IS NULL",
    params: { id: mediaId }
  });
export const deleteMedia = mediaId =>
  run(
    "none",
    `UPDATE land.property_media SET deleted_at = now(), is_cover = false WHERE id = $1 AND deleted_at IS NULL`,
    [mediaId]
  );
export const reorderMedia = async (propertyId, mediaIds) => {
  const result = await pg.tx(async transaction => {
    for (const [index, mediaId] of mediaIds.entries())
      await transaction.none(
        `UPDATE land.property_media SET sort_order = $3 WHERE id = $1 AND property_id = $2 AND deleted_at IS NULL`,
        [mediaId, propertyId, index]
      );
  });
  if (!result.ok) throw result.error;
};
export const setCover = async (propertyId, mediaId) => {
  const result = await pg.tx(async transaction => {
    await transaction.none(
      `UPDATE land.property_media SET is_cover = false WHERE property_id = $1 AND deleted_at IS NULL`,
      [propertyId]
    );
    await transaction.none(
      `UPDATE land.property_media SET is_cover = true WHERE id = $1 AND property_id = $2 AND deleted_at IS NULL`,
      [mediaId, propertyId]
    );
  });
  if (!result.ok) throw result.error;
};
export const documents = propertyId =>
  run(
    "any",
    `SELECT d.id, d.storage_key AS "storageKey", d.file_name AS "fileName", d.mime_type AS "mimeType", d.file_size_bytes AS "fileSizeBytes", d.visibility, d.verification_status AS "verificationStatus", d.created_at AS "createdAt", jsonb_build_object('id', dt.id, 'code', dt.code, 'name', dt.name, 'sortOrder', dt.sort_order) AS "documentType" FROM land.property_documents d JOIN land.document_types dt ON dt.id = d.document_type_id WHERE d.property_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`,
    [propertyId]
  );
export const document = (propertyId, documentId) =>
  run(
    "oneOrNone",
    `SELECT d.id, d.storage_key AS "storageKey", d.file_name AS "fileName", d.mime_type AS "mimeType", d.file_size_bytes AS "fileSizeBytes", d.visibility, d.verification_status AS "verificationStatus", d.created_at AS "createdAt", jsonb_build_object('id', dt.id, 'code', dt.code, 'name', dt.name, 'sortOrder', dt.sort_order) AS "documentType" FROM land.property_documents d JOIN land.document_types dt ON dt.id = d.document_type_id WHERE d.id = $1 AND d.property_id = $2 AND d.deleted_at IS NULL`,
    [documentId, propertyId]
  );
export const createDocument = input =>
  run(
    "one",
    `INSERT INTO land.property_documents (property_id, document_type_id, storage_key, file_name, mime_type, file_size_bytes, visibility, uploaded_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      input.propertyId,
      input.documentTypeId,
      input.storageKey,
      input.fileName,
      input.mimeType,
      input.fileSizeBytes,
      input.visibility,
      input.userId
    ]
  );
export const deleteDocument = documentId =>
  run(
    "none",
    `UPDATE land.property_documents SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
    [documentId]
  );

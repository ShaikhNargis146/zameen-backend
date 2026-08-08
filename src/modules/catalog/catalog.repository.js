import pg from "../../utils/postgres_store.js";

const query = async (method, sql, params = []) => {
  const result = await pg[method](sql, params);
  if (!result.ok) throw result.error;
  return result.data;
};

const masters = Object.freeze({
  "property-types": "land.property_types",
  "land-use-types": "land.land_use_types",
  "ownership-types": "land.ownership_types",
  "area-units": "land.area_units",
  "road-types": "land.road_types",
  amenities: "land.amenities",
  "document-types": "land.document_types"
});

export const listMaster = key =>
  query(
    "any",
    `SELECT * FROM ${masters[key]} WHERE is_active = true ORDER BY sort_order, name`
  );
export const listParcelConfig = code =>
  query(
    "any",
    `SELECT pit.id, pit.code, pit.name, pit.is_required, pit.sort_order FROM land.parcel_identifier_types pit JOIN geo.locations state ON state.id = pit.state_location_id WHERE state.type = 'STATE' AND state.state_code = $1 AND pit.is_active = true ORDER BY pit.sort_order, pit.name`,
    [code]
  );
export const searchLocations = value =>
  query(
    "any",
    `SELECT DISTINCT l.id, l.parent_id, l.type, l.name, l.slug, l.state_code FROM geo.locations l LEFT JOIN geo.location_aliases a ON a.location_id = l.id WHERE l.is_active = true AND (l.name ILIKE $1 OR a.alias ILIKE $1) ORDER BY l.type, l.name LIMIT 20`,
    [`%${value}%`]
  );
export const locationsForPincode = pincode =>
  query(
    "any",
    `SELECT l.id, l.parent_id, l.type, l.name, l.slug, l.state_code FROM geo.postal_codes p JOIN geo.postal_code_locations pl ON pl.postal_code_id = p.id JOIN geo.locations l ON l.id = pl.location_id WHERE p.code = $1 AND l.is_active = true ORDER BY l.type, l.name`,
    [pincode]
  );
export const listStates = () =>
  query(
    "any",
    `SELECT id, name, slug, state_code FROM geo.locations WHERE type = 'STATE' AND is_active = true ORDER BY name`
  );
export const childrenForLocation = id =>
  query(
    "any",
    `SELECT id, parent_id, type, name, slug, state_code FROM geo.locations WHERE parent_id = $1 AND is_active = true ORDER BY type, name`,
    [id]
  );
export const findLocation = id =>
  query(
    "oneOrNone",
    `SELECT id, parent_id, type, name, slug, state_code, CASE WHEN center IS NULL THEN NULL ELSE ST_Y(center::geometry) END AS latitude, CASE WHEN center IS NULL THEN NULL ELSE ST_X(center::geometry) END AS longitude FROM geo.locations WHERE id = $1 AND is_active = true`,
    [id]
  );

export { masters };

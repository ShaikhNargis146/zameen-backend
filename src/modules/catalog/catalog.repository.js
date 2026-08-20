import { run } from "../../shared/db.js";
const locationFields = `l.id, l.name, l.type, l.parent_id AS "parentId", l.state_code AS "stateCode", CASE WHEN l.center IS NULL THEN NULL ELSE ST_Y(l.center::geometry) END AS latitude, CASE WHEN l.center IS NULL THEN NULL ELSE ST_X(l.center::geometry) END AS longitude, COALESCE((WITH RECURSIVE ancestors AS (SELECT id, parent_id, name, 0 AS depth FROM geo.locations WHERE id = l.id UNION ALL SELECT parent.id, parent.parent_id, parent.name, ancestors.depth + 1 FROM geo.locations parent JOIN ancestors ON ancestors.parent_id = parent.id) SELECT string_agg(name, ', ' ORDER BY depth DESC) FROM ancestors), l.name) AS "displayPath"`;

const masters = Object.freeze({
  "property-types": "land.property_types",
  "land-use-types": "land.land_use_types",
  "ownership-types": "land.ownership_types",
  "road-types": "land.road_types",
  "document-types": "land.document_types"
});

export const listMaster = key =>
  run(
    "any",
    `SELECT id, code, name, sort_order AS "sortOrder" FROM ${masters[key]} WHERE is_active = true ORDER BY sort_order, name`
  );
export const listAreaUnits = stateCode =>
  run(
    "any",
    `SELECT u.id, u.code, u.name, state.state_code AS "stateCode", u.sqft_multiplier::float8 AS "sqftMultiplier" FROM land.area_units u LEFT JOIN geo.locations state ON state.id = u.state_location_id WHERE u.is_active = true AND ($1::varchar IS NULL OR state.state_code = $1 OR u.state_location_id IS NULL) ORDER BY u.name`,
    [stateCode || null]
  );
export const listAmenities = category =>
  run(
    "any",
    `SELECT id, code, name, category, sort_order AS "sortOrder" FROM land.amenities WHERE is_active = true AND ($1::varchar IS NULL OR category = $1) ORDER BY sort_order, name`,
    [category || null]
  );
export const listParcelConfig = code =>
  run(
    "any",
    `SELECT pit.code AS type, pit.name AS label, pit.is_required AS required, concat('Enter ', pit.name) AS placeholder FROM land.parcel_identifier_types pit JOIN geo.locations state ON state.id = pit.state_location_id WHERE state.type = 'STATE' AND state.state_code = $1 AND pit.is_active = true ORDER BY pit.sort_order, pit.name`,
    [code]
  );
export const searchLocations = ({ q, types, stateCode, limit }) =>
  run(
    "any",
    `SELECT DISTINCT ${locationFields} FROM geo.locations l LEFT JOIN geo.location_aliases a ON a.location_id = l.id WHERE l.is_active = true AND (l.name ILIKE $1 OR a.alias ILIKE $1) AND ($2::varchar[] IS NULL OR l.type = ANY($2)) AND ($3::varchar IS NULL OR l.state_code = $3) ORDER BY l.type, l.name LIMIT $4`,
    [`%${q}%`, types, stateCode, limit]
  );
export const locationsForPincode = pincode =>
  run(
    "any",
    `SELECT ${locationFields} FROM geo.postal_codes p JOIN geo.postal_code_locations pl ON pl.postal_code_id = p.id JOIN geo.locations l ON l.id = pl.location_id WHERE p.code = $1 AND l.is_active = true ORDER BY l.type, l.name`,
    [pincode]
  );
export const listStates = () =>
  run(
    "any",
    `SELECT ${locationFields} FROM geo.locations l WHERE l.type = 'STATE' AND l.is_active = true ORDER BY l.name`
  );
export const childrenForLocation = (id, type = null) =>
  run(
    "any",
    `SELECT ${locationFields} FROM geo.locations l WHERE l.parent_id = $1 AND l.is_active = true AND ($2::varchar IS NULL OR l.type = $2) ORDER BY l.type, l.name`,
    [id, type]
  );
export const findLocation = id =>
  run(
    "oneOrNone",
    `SELECT ${locationFields} FROM geo.locations l WHERE l.id = $1 AND l.is_active = true`,
    [id]
  );
export const geocode = ({ q, limit }) =>
  run(
    "any",
    `SELECT ${locationFields} FROM geo.locations l WHERE l.is_active = true AND l.center IS NOT NULL AND l.name ILIKE $1 ORDER BY l.type, l.name LIMIT $2`,
    [`%${q}%`, limit]
  );
export const reverseGeocode = ({ latitude, longitude }) =>
  run(
    "oneOrNone",
    `SELECT ${locationFields} FROM geo.locations l WHERE l.is_active = true AND l.center IS NOT NULL ORDER BY l.center <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography LIMIT 1`,
    [latitude, longitude]
  );

export { masters };

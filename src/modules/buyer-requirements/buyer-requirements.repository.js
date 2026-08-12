import { pg, run } from "../../shared/db.js";

const columns = `
  id, user_id AS "userId", name, location_id AS "locationId", property_type_id AS "propertyTypeId",
  min_area_sqft AS "normalizedMinAreaSqft", max_area_sqft AS "normalizedMaxAreaSqft",
  min_budget_minor AS "minBudgetMinor", max_budget_minor AS "maxBudgetMinor", purpose,
  extra_filters AS "extraFilters", status, created_at AS "createdAt", updated_at AS "updatedAt"
`;

export const findAreaUnit = id =>
  run(
    "oneOrNone",
    `SELECT id, sqft_multiplier AS "sqftMultiplier" FROM land.area_units WHERE id = $1`,
    [id]
  );

export const insert = ({
  userId,
  name,
  locationId,
  propertyTypeId,
  minAreaSqft,
  maxAreaSqft,
  minBudgetMinor,
  maxBudgetMinor,
  purpose,
  status,
  extraFilters
}) =>
  pg.one(
    `INSERT INTO marketplace.buyer_requirements
       (user_id, name, location_id, property_type_id, min_area_sqft, max_area_sqft, min_budget_minor, max_budget_minor, purpose, status, extra_filters)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     RETURNING ${columns}`,
    [
      userId,
      name,
      locationId,
      propertyTypeId,
      minAreaSqft,
      maxAreaSqft,
      minBudgetMinor,
      maxBudgetMinor,
      purpose,
      status,
      JSON.stringify(extraFilters)
    ]
  );

export const findOwned = (id, userId) =>
  run(
    "oneOrNone",
    `SELECT ${columns} FROM marketplace.buyer_requirements WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

const listForUserFilters = `
     WHERE user_id = $1
       AND ($2::varchar IS NULL OR name ILIKE $2)
       AND ($3::uuid IS NULL OR location_id = $3)
       AND ($4::uuid IS NULL OR property_type_id = $4)
       AND ($5::varchar IS NULL OR purpose = $5)
       AND ($6::varchar IS NULL OR status = $6)
       AND ($7::boolean IS NULL OR (extra_filters->>'verifiedOnly')::boolean = $7)`;

const listForUserParams = (
  userId,
  { search, locationId, propertyTypeId, purpose, status, verifiedOnly }
) => [
  userId,
  search ? `%${search}%` : null,
  locationId || null,
  propertyTypeId || null,
  purpose || null,
  status || null,
  verifiedOnly ?? null
];

export const listForUser = (userId, filters, { limit, offset }) =>
  run(
    "any",
    `SELECT ${columns}, count(*) OVER()::int AS total FROM marketplace.buyer_requirements
     ${listForUserFilters}
     ORDER BY created_at DESC LIMIT $8 OFFSET $9`,
    [...listForUserParams(userId, filters), limit, offset]
  );

export const update = (id, set) =>
  pg.updateWhere({
    table: "marketplace.buyer_requirements",
    set,
    where: "id = ${id}",
    params: { id },
    returning: columns,
    jsonbCols: ["extra_filters"]
  });

export const remove = id =>
  run("none", `DELETE FROM marketplace.buyer_requirements WHERE id = $1`, [id]);

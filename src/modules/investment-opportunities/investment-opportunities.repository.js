import { pg, run } from "../../shared/db.js";

const opportunityColumns = `io.id, io.title, io.location_id AS "locationId", io.property_id AS "propertyId", io.investment_type AS "investmentType", io.minimum_investment_minor AS "minimumInvestmentMinor", io.description, io.status, io.published_at AS "publishedAt"`;

const locationFields = `loc.name AS "locationName", loc.type AS "locationType", loc.parent_id AS "locationParentId", loc.state_code AS "locationStateCode", CASE WHEN loc.center IS NULL THEN NULL ELSE ST_Y(loc.center::geometry) END AS "locationLatitude", CASE WHEN loc.center IS NULL THEN NULL ELSE ST_X(loc.center::geometry) END AS "locationLongitude", COALESCE((WITH RECURSIVE ancestors AS (SELECT id, parent_id, name, 0 AS depth FROM geo.locations WHERE id = loc.id UNION ALL SELECT parent.id, parent.parent_id, parent.name, ancestors.depth + 1 FROM geo.locations parent JOIN ancestors ON ancestors.parent_id = parent.id) SELECT string_agg(name, ', ' ORDER BY depth DESC) FROM ancestors), loc.name) AS "locationDisplayPath"`;

export const list = ({ locationId, investmentType, statuses, limit, offset }) =>
  run(
    "any",
    `SELECT ${opportunityColumns}, ${locationFields}, count(*) OVER()::int AS total
     FROM content.investment_opportunities io
     LEFT JOIN geo.locations loc ON loc.id = io.location_id
     WHERE ($1::uuid IS NULL OR io.location_id = $1)
       AND ($2::varchar IS NULL OR io.investment_type ILIKE $2)
       AND ($3::varchar[] IS NULL OR io.status = ANY($3::varchar[]))
     ORDER BY io.published_at DESC NULLS LAST, io.created_at DESC
     LIMIT $4 OFFSET $5`,
    [locationId, investmentType, statuses, limit, offset]
  );

export const findById = id =>
  run(
    "oneOrNone",
    `SELECT ${opportunityColumns}, ${locationFields}
     FROM content.investment_opportunities io
     LEFT JOIN geo.locations loc ON loc.id = io.location_id
     WHERE io.id = $1`,
    [id]
  );

export const create = ({
  title,
  locationId,
  propertyId,
  investmentType,
  minimumInvestmentMinor,
  description,
  createdByUserId
}) =>
  run(
    "one",
    `INSERT INTO content.investment_opportunities (title, location_id, property_id, investment_type, minimum_investment_minor, description, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [title, locationId, propertyId, investmentType, minimumInvestmentMinor, description, createdByUserId]
  );

export const update = (id, changes) =>
  pg.updateWhere({
    table: "content.investment_opportunities",
    set: { ...changes, updated_at: new Date() },
    where: "id = ${id}",
    params: { id },
    returning: "id"
  });

export const setStatus = ({ id, status, validStatuses, setPublishedAt }) =>
  run(
    "oneOrNone",
    `UPDATE content.investment_opportunities SET status = $2, updated_at = now()${
      setPublishedAt ? ", published_at = now()" : ""
    }
     WHERE id = $1 AND status = ANY($3::varchar[])
     RETURNING id`,
    [id, status, validStatuses]
  );

export const audit = ({ actorId, action, opportunityId, before, after, note }) =>
  run(
    "none",
    `INSERT INTO ops.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1,$2,'content.investment_opportunities',$3,$4::jsonb,$5::jsonb)`,
    [
      actorId,
      action,
      opportunityId,
      JSON.stringify(before || {}),
      JSON.stringify({ ...(after || {}), note: note || null })
    ]
  );

const interestColumns = `id, opportunity_id AS "opportunityId", status, created_at AS "createdAt"`;

export const createInterest = ({ opportunityId, userId, organizationId, contactPhone, contactEmail, message }) =>
  run(
    "one",
    `INSERT INTO content.investment_interests (opportunity_id, user_id, organization_id, contact_phone, contact_email, message)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${interestColumns}`,
    [opportunityId, userId, organizationId, contactPhone, contactEmail, message]
  );

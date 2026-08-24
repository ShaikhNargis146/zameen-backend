import { pg, run } from "../../shared/db.js";

const auctionColumns = `a.id, a.title, a.institution_name AS "institutionName", a.reserve_price_minor AS "reservePriceMinor", a.currency, a.emd_amount_minor AS "emdAmountMinor", a.auction_at AS "auctionAt", a.official_url AS "officialUrl", a.description, a.status`;

const locationFields = `loc.name AS "locationName", loc.type AS "locationType", loc.parent_id AS "locationParentId", loc.state_code AS "locationStateCode", CASE WHEN loc.center IS NULL THEN NULL ELSE ST_Y(loc.center::geometry) END AS "locationLatitude", CASE WHEN loc.center IS NULL THEN NULL ELSE ST_X(loc.center::geometry) END AS "locationLongitude", COALESCE((WITH RECURSIVE ancestors AS (SELECT id, parent_id, name, 0 AS depth FROM geo.locations WHERE id = loc.id UNION ALL SELECT parent.id, parent.parent_id, parent.name, ancestors.depth + 1 FROM geo.locations parent JOIN ancestors ON ancestors.parent_id = parent.id) SELECT string_agg(name, ', ' ORDER BY depth DESC) FROM ancestors), loc.name) AS "locationDisplayPath"`;

export const list = ({ locationId, status, fromDate, toDate, limit, offset }) =>
  run(
    "any",
    `SELECT ${auctionColumns}, a.location_id AS "locationId", ${locationFields}, count(*) OVER()::int AS total
     FROM content.auctions a
     LEFT JOIN geo.locations loc ON loc.id = a.location_id
     WHERE ($1::uuid IS NULL OR a.location_id = $1)
       AND ($2::varchar IS NULL OR a.status = $2)
       AND ($3::timestamptz IS NULL OR a.auction_at >= $3)
       AND ($4::timestamptz IS NULL OR a.auction_at <= $4)
     ORDER BY a.auction_at ASC
     LIMIT $5 OFFSET $6`,
    [locationId, status, fromDate, toDate, limit, offset]
  );

export const findById = id =>
  run(
    "oneOrNone",
    `SELECT ${auctionColumns}, a.location_id AS "locationId", ${locationFields}
     FROM content.auctions a
     LEFT JOIN geo.locations loc ON loc.id = a.location_id
     WHERE a.id = $1`,
    [id]
  );

export const create = ({
  title,
  institutionName,
  locationId,
  reservePriceMinor,
  emdAmountMinor,
  auctionAt,
  officialUrl,
  description,
  status
}) =>
  run(
    "one",
    `INSERT INTO content.auctions (title, institution_name, location_id, reserve_price_minor, emd_amount_minor, auction_at, official_url, description, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [title, institutionName, locationId, reservePriceMinor, emdAmountMinor, auctionAt, officialUrl, description, status]
  );

export const update = (id, changes) =>
  pg.updateWhere({
    table: "content.auctions",
    set: { ...changes, updated_at: new Date() },
    where: "id = ${id}",
    params: { id },
    returning: "id"
  });

export const remove = id =>
  run("oneOrNone", `DELETE FROM content.auctions WHERE id = $1 RETURNING id`, [id]);

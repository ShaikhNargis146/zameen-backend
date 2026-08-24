import { pg, run } from "../../shared/db.js";

const adColumns = `a.id, a.name, a.placement, a.image_storage_key AS "imageStorageKey", a.target_url AS "targetUrl", a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status`;

export const listActive = placementValue =>
  run(
    "any",
    `SELECT ${adColumns}
     FROM content.ads a
     WHERE a.placement = $1 AND a.status = 'ACTIVE' AND a.starts_at <= now() AND a.ends_at > now()
     ORDER BY a.starts_at ASC`,
    [placementValue]
  );

export const findById = id =>
  run("oneOrNone", `SELECT ${adColumns} FROM content.ads a WHERE a.id = $1`, [id]);

export const create = ({ name, placement, imageStorageKey, targetUrl, startsAt, endsAt, status }) =>
  run(
    "one",
    `INSERT INTO content.ads (name, placement, image_storage_key, target_url, starts_at, ends_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [name, placement, imageStorageKey, targetUrl, startsAt, endsAt, status]
  );

export const update = (id, changes) =>
  pg.updateWhere({
    table: "content.ads",
    set: { ...changes, updated_at: new Date() },
    where: "id = ${id}",
    params: { id },
    returning: "id"
  });

export const remove = id => run("oneOrNone", `DELETE FROM content.ads WHERE id = $1 RETURNING id`, [id]);

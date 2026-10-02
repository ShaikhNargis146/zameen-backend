import { pg, run } from "../../shared/db.js";

const adColumns = `a.id, a.name, a.placement, (SELECT m.storage_key FROM content.ad_media m WHERE m.ad_id = a.id AND m.deleted_at IS NULL AND m.is_cover = true LIMIT 1) AS "imageStorageKey", a.target_url AS "targetUrl", a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, a.created_at AS "createdAt", a.updated_at AS "updatedAt"`;

export const listActive = placementValue =>
  run(
    "any",
    `SELECT ${adColumns}
     FROM content.ads a
     WHERE a.placement = $1 AND a.status = 'ACTIVE' AND a.starts_at <= now() AND a.ends_at > now()
       AND EXISTS (SELECT 1 FROM content.ad_media m WHERE m.ad_id = a.id AND m.deleted_at IS NULL AND m.is_cover = true)
     ORDER BY a.starts_at ASC`,
    [placementValue]
  );

export const findById = id =>
  run("oneOrNone", `SELECT ${adColumns} FROM content.ads a WHERE a.id = $1`, [id]);

export const listAdmin = ({ status, placement, search, limit, offset }) =>
  run(
    "any",
    `SELECT ${adColumns}, count(*) OVER()::int AS total
     FROM content.ads a
     WHERE ($1::varchar IS NULL OR a.status = $1)
       AND ($2::varchar IS NULL OR a.placement = $2)
       AND ($3::varchar IS NULL OR a.name ILIKE $3)
     ORDER BY a.created_at DESC
     LIMIT $4 OFFSET $5`,
    [status, placement, search ? `%${search}%` : null, limit, offset]
  );

export const create = ({ name, placement, targetUrl, startsAt, endsAt, status }) =>
  run(
    "one",
    `INSERT INTO content.ads (name, placement, target_url, starts_at, ends_at, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [name, placement, targetUrl, startsAt, endsAt, status]
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

export const media = adId =>
  run(
    "any",
    `SELECT id, storage_key AS "storageKey", mime_type AS "mimeType", sort_order AS "sortOrder", is_cover AS "isCover" FROM content.ad_media WHERE ad_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at`,
    [adId]
  );

export const mediaForAd = (adId, mediaId) =>
  run(
    "oneOrNone",
    `SELECT id FROM content.ad_media WHERE id = $1 AND ad_id = $2 AND deleted_at IS NULL`,
    [mediaId, adId]
  );

export const createMediaBatch = async (adId, items) => {
  const result = await pg.tx(async transaction => {
    const ids = [];
    for (const input of items) {
      const row = await transaction.one(
        `INSERT INTO content.ad_media (ad_id, storage_key, mime_type, sort_order, is_cover, uploaded_by_user_id) VALUES ($1,$2,$3,$4,false,$5) RETURNING id`,
        [adId, input.storageKey, input.mimeType, input.sortOrder, input.userId]
      );
      ids.push(row.id);
    }
    const coverIndex = items.map(item => item.isCover).lastIndexOf(true);
    if (coverIndex !== -1) {
      await transaction.none(
        `UPDATE content.ad_media SET is_cover = false WHERE ad_id = $1 AND deleted_at IS NULL`,
        [adId]
      );
      await transaction.none(`UPDATE content.ad_media SET is_cover = true WHERE id = $1`, [ids[coverIndex]]);
    }
    return ids;
  });
  if (!result.ok) throw result.error;
  return result.data;
};

export const updateMedia = (mediaId, changes) =>
  pg.updateWhere({
    table: "content.ad_media",
    set: changes,
    where: "id = ${id} AND deleted_at IS NULL",
    params: { id: mediaId }
  });

export const deleteMedia = mediaId =>
  run(
    "none",
    `UPDATE content.ad_media SET deleted_at = now(), is_cover = false WHERE id = $1 AND deleted_at IS NULL`,
    [mediaId]
  );

export const reorderMedia = async (adId, mediaIds) => {
  const result = await pg.tx(async transaction => {
    for (const [index, mediaId] of mediaIds.entries())
      await transaction.none(
        `UPDATE content.ad_media SET sort_order = $3 WHERE id = $1 AND ad_id = $2 AND deleted_at IS NULL`,
        [mediaId, adId, index]
      );
  });
  if (!result.ok) throw result.error;
};

export const setCover = async (adId, mediaId) => {
  const result = await pg.tx(async transaction => {
    await transaction.none(
      `UPDATE content.ad_media SET is_cover = false WHERE ad_id = $1 AND deleted_at IS NULL`,
      [adId]
    );
    await transaction.none(
      `UPDATE content.ad_media SET is_cover = true WHERE id = $1 AND ad_id = $2 AND deleted_at IS NULL`,
      [mediaId, adId]
    );
  });
  if (!result.ok) throw result.error;
};

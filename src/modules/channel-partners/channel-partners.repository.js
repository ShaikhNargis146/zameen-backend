import { pg, run } from "../../shared/db.js";
import { addRole as grantRole } from "../users/users.repository.js";

const runTx = async fn => {
  const result = await pg.tx(fn);
  if (!result.ok) throw result.error;
  return result.data;
};

const profileColumns = `cp.user_id AS "userId", cp.organization_id AS "organizationId", cp.rera_number AS "reraNumber", cp.experience_years AS "experienceYears", cp.status, cp.approved_at AS "approvedAt"`;

export const findByUserId = userId =>
  run(
    "oneOrNone",
    `SELECT ${profileColumns} FROM account.channel_partner_profiles cp WHERE cp.user_id = $1`,
    [userId]
  );

export const listAdmin = ({ status, locationId, search, limit, offset }) =>
  run(
    "any",
    `SELECT ${profileColumns}, count(*) OVER()::int AS total
     FROM account.channel_partner_profiles cp
     JOIN auth.users u ON u.id = cp.user_id
     LEFT JOIN account.organizations o ON o.id = cp.organization_id
     WHERE ($1::varchar IS NULL OR cp.status = $1)
       AND ($2::uuid IS NULL OR EXISTS (
         SELECT 1 FROM account.channel_partner_locations cpl
         WHERE cpl.channel_partner_user_id = cp.user_id AND cpl.location_id = $2
       ))
       AND ($3::varchar IS NULL OR u.display_name ILIKE $3 OR o.name ILIKE $3)
     ORDER BY cp.created_at DESC
     LIMIT $4 OFFSET $5`,
    [status, locationId, search, limit, offset]
  );

export const createProfile = ({ userId, organizationId, reraNumber, experienceYears, about, locationIds }) =>
  runTx(async t => {
    await t.none(
      `INSERT INTO account.channel_partner_profiles (user_id, organization_id, rera_number, about, experience_years)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, organizationId, reraNumber, about, experienceYears]
    );
    for (const locationId of locationIds)
      await t.none(
        `INSERT INTO account.channel_partner_locations (channel_partner_user_id, location_id) VALUES ($1,$2)`,
        [userId, locationId]
      );
    return userId;
  });

export const updateProfileFields = (userId, changes) =>
  pg.updateWhere({
    table: "account.channel_partner_profiles",
    set: { ...changes, updated_at: new Date() },
    where: "user_id = ${userId}",
    params: { userId },
    returning: "user_id"
  });

export const replaceLocations = (userId, locationIds) =>
  runTx(async t => {
    await t.none(`DELETE FROM account.channel_partner_locations WHERE channel_partner_user_id = $1`, [userId]);
    for (const locationId of locationIds)
      await t.none(
        `INSERT INTO account.channel_partner_locations (channel_partner_user_id, location_id) VALUES ($1,$2)`,
        [userId, locationId]
      );
    return true;
  });

export const setStatus = ({ userId, status, validStatuses, approvedByUserId = null, setApprovedAt = false }) =>
  run(
    "oneOrNone",
    `UPDATE account.channel_partner_profiles
     SET status = $2, updated_at = now()${
       setApprovedAt ? ", approved_at = now(), approved_by_user_id = $4" : ""
     }
     WHERE user_id = $1 AND status = ANY($3::varchar[])
     RETURNING user_id`,
    [userId, status, validStatuses, approvedByUserId]
  );

export const grantChannelPartnerRole = userId => grantRole(userId, "CHANNEL_PARTNER");
export const revokeChannelPartnerRole = userId =>
  run(
    "none",
    `DELETE FROM auth.user_roles ur USING auth.roles r WHERE ur.role_id = r.id AND ur.user_id = $1 AND r.code = 'CHANNEL_PARTNER'`,
    [userId]
  );

export const audit = ({ actorId, action, partnerId, before, after, note }) =>
  run(
    "none",
    `INSERT INTO ops.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1,$2,'account.channel_partner_profiles',$3,$4::jsonb,$5::jsonb)`,
    [
      actorId,
      action,
      partnerId,
      JSON.stringify(before || {}),
      JSON.stringify({ ...(after || {}), note: note || null })
    ]
  );

const locationFields = `loc.id, loc.name, loc.type, loc.parent_id AS "parentId", loc.state_code AS "stateCode", CASE WHEN loc.center IS NULL THEN NULL ELSE ST_Y(loc.center::geometry) END AS latitude, CASE WHEN loc.center IS NULL THEN NULL ELSE ST_X(loc.center::geometry) END AS longitude, COALESCE((WITH RECURSIVE ancestors AS (SELECT id, parent_id, name, 0 AS depth FROM geo.locations WHERE id = loc.id UNION ALL SELECT parent.id, parent.parent_id, parent.name, ancestors.depth + 1 FROM geo.locations parent JOIN ancestors ON ancestors.parent_id = parent.id) SELECT string_agg(name, ', ' ORDER BY depth DESC) FROM ancestors), loc.name) AS "displayPath"`;

export const locationsForPartners = userIds =>
  run(
    "any",
    `SELECT cpl.channel_partner_user_id AS "partnerId", ${locationFields}
     FROM account.channel_partner_locations cpl
     JOIN geo.locations loc ON loc.id = cpl.location_id
     WHERE cpl.channel_partner_user_id = ANY($1::uuid[])
     ORDER BY loc.name`,
    [userIds]
  );

const organizationColumns = `id, name, type, slug, phone, email, gst_number AS "gstNumber", rera_number AS "reraNumber", logo_storage_key AS "logoStorageKey", status`;

export const organizationsByIds = ids =>
  ids.length
    ? run(
        "any",
        `SELECT ${organizationColumns} FROM account.organizations WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [ids]
      )
    : Promise.resolve([]);

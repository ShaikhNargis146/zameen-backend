import pg from "../../utils/postgres_store.js";

const run = async (method, sql, params = []) => {
  const result = await pg[method](sql, params);
  if (!result.ok) throw result.error;
  return result.data;
};

export const findUser = id =>
  run(
    "oneOrNone",
    `SELECT u.id, u.first_name AS "firstName", u.last_name AS "lastName", u.display_name AS "displayName", u.phone_e164 AS "phoneE164", u.email, u.avatar_storage_key AS "avatarUrl", u.preferred_language AS "preferredLanguage", u.status, u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt", u.deleted_at AS "deletedAt" FROM auth.users u WHERE u.id = $1`,
    [id]
  );
export const listUsers = ({ status, role, search, limit, offset }) =>
  run(
    "any",
    `SELECT u.id, u.first_name AS "firstName", u.last_name AS "lastName", u.display_name AS "displayName", u.phone_e164 AS "phoneE164", u.email, u.avatar_storage_key AS "avatarUrl", u.preferred_language AS "preferredLanguage", u.status, u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt", COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles FROM auth.users u LEFT JOIN auth.user_roles ur ON ur.user_id = u.id LEFT JOIN auth.roles r ON r.id = ur.role_id WHERE ($1::varchar IS NULL OR u.status = $1) AND ($2::varchar IS NULL OR u.display_name ILIKE $2 OR u.phone_e164 ILIKE $2 OR u.email::text ILIKE $2) GROUP BY u.id HAVING ($3::varchar IS NULL OR $3 = ANY(array_agg(r.code))) ORDER BY max(u.created_at) DESC LIMIT $4 OFFSET $5`,
    [status, search ? `%${search}%` : null, role, limit, offset]
  );
export const countUsers = ({ status, role, search }) =>
  run(
    "one",
    `SELECT count(*)::int AS total FROM auth.users u WHERE ($1::varchar IS NULL OR u.status = $1) AND ($2::varchar IS NULL OR u.display_name ILIKE $2 OR u.phone_e164 ILIKE $2 OR u.email::text ILIKE $2) AND ($3::varchar IS NULL OR EXISTS (SELECT 1 FROM auth.user_roles ur JOIN auth.roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = $3))`,
    [status, search ? `%${search}%` : null, role]
  );
export const updateProfile = (id, changes) =>
  pg.updateWhere({
    table: "auth.users",
    set: changes,
    where: "id = ${id} AND deleted_at IS NULL",
    params: { id }
  });
export const setUserStatus = (id, status) =>
  run(
    "oneOrNone",
    `UPDATE auth.users SET status = $2, deleted_at = CASE WHEN $2 = 'DELETED' THEN COALESCE(deleted_at, now()) ELSE NULL END WHERE id = $1 RETURNING id`,
    [id, status]
  );
export const revokeSessions = id =>
  run(
    "none",
    `UPDATE auth.refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [id]
  );
export const addRole = (userId, code) =>
  run(
    "none",
    `INSERT INTO auth.user_roles (user_id, role_id) SELECT $1, id FROM auth.roles WHERE code = $2 ON CONFLICT DO NOTHING`,
    [userId, code]
  );
export const findRoles = codes =>
  run(
    "any",
    `SELECT id, code FROM auth.roles WHERE code = ANY($1::varchar[])`,
    [codes]
  );
export const replaceRoles = async (userId, roles) => {
  const result = await pg.tx(async transaction => {
    await transaction.none(`DELETE FROM auth.user_roles WHERE user_id = $1`, [
      userId
    ]);
    for (const role of roles)
      await transaction.none(
        `INSERT INTO auth.user_roles (user_id, role_id) VALUES ($1,$2)`,
        [userId, role.id]
      );
  });
  if (!result.ok) throw result.error;
};
export const audit = ({
  actorId,
  action,
  entityId,
  before,
  after,
  ip,
  requestId
}) =>
  run(
    "none",
    `INSERT INTO ops.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address, request_id) VALUES ($1,$2,'auth.users',$3,$4::jsonb,$5::jsonb,$6,$7)`,
    [
      actorId,
      action,
      entityId,
      JSON.stringify(before || {}),
      JSON.stringify(after || {}),
      ip || null,
      requestId || null
    ]
  );

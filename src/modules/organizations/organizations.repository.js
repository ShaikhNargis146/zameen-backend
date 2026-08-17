import pg from "../../utils/postgres_store.js";

const run = async (method, sql, params = []) => {
  const result = await pg[method](sql, params);
  if (!result.ok) throw result.error;
  return result.data;
};

const organizationColumns = `id, name, type, slug, phone, email, gst_number AS "gstNumber", rera_number AS "reraNumber", logo_storage_key AS "logoStorageKey", status`;

export const createWithOwner = async ({
  name,
  type,
  phone,
  email,
  gstNumber,
  reraNumber,
  logoStorageKey,
  createdByUserId
}) => {
  const result = await pg.tx(async t => {
    const organization = await t.one(
      `INSERT INTO account.organizations (name, type, phone, email, gst_number, rera_number, logo_storage_key, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${organizationColumns}`,
      [name, type, phone, email, gstNumber, reraNumber, logoStorageKey, createdByUserId]
    );
    await t.none(
      `INSERT INTO account.organization_members (organization_id, user_id, role, status, joined_at)
       VALUES ($1,$2,'OWNER','ACTIVE',now())`,
      [organization.id, createdByUserId]
    );
    return organization;
  });
  if (!result.ok) throw result.error;
  return result.data;
};

export const findById = id =>
  run(
    "oneOrNone",
    `SELECT ${organizationColumns} FROM account.organizations WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );

const listForUserFilters = `
     WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND o.deleted_at IS NULL
       AND ($2::varchar IS NULL OR o.name ILIKE $2 OR o.slug ILIKE $2 OR o.phone ILIKE $2 OR o.email ILIKE $2 OR o.gst_number ILIKE $2 OR o.rera_number ILIKE $2)
       AND ($3::varchar IS NULL OR o.name ILIKE $3)
       AND ($4::varchar IS NULL OR o.type = $4)
       AND ($5::varchar IS NULL OR o.slug ILIKE $5)
       AND ($6::varchar IS NULL OR o.phone ILIKE $6)
       AND ($7::varchar IS NULL OR o.email ILIKE $7)
       AND ($8::varchar IS NULL OR o.gst_number ILIKE $8)
       AND ($9::varchar IS NULL OR o.rera_number ILIKE $9)
       AND ($10::varchar IS NULL OR o.status = $10)
       AND ($11::varchar IS NULL OR m.role = $11)`;

const listForUserParams = (
  userId,
  { search, name, type, slug, phone, email, gstNumber, reraNumber, status, role }
) => [
  userId,
  search ? `%${search}%` : null,
  name ? `%${name}%` : null,
  type || null,
  slug ? `%${slug}%` : null,
  phone ? `%${phone}%` : null,
  email ? `%${email}%` : null,
  gstNumber ? `%${gstNumber}%` : null,
  reraNumber ? `%${reraNumber}%` : null,
  status || null,
  role || null
];

export const listForUser = (userId, filters, { limit, offset }) =>
  run(
    "any",
    `SELECT o.id, o.name, o.type, o.slug, o.phone, o.email, o.gst_number AS "gstNumber", o.rera_number AS "reraNumber", o.logo_storage_key AS "logoStorageKey", o.status,
            m.role, m.joined_at AS "joinedAt", count(*) OVER()::int AS total
     FROM account.organizations o
     JOIN account.organization_members m ON m.organization_id = o.id
     ${listForUserFilters}
     ORDER BY o.created_at DESC
     LIMIT $12 OFFSET $13`,
    [...listForUserParams(userId, filters), limit, offset]
  );

export const update = (id, changes) =>
  pg.updateWhere({
    table: "account.organizations",
    set: changes,
    where: "id = ${id} AND deleted_at IS NULL",
    params: { id },
    returning: organizationColumns
  });

export const setStatus = (id, status) =>
  run(
    "oneOrNone",
    `UPDATE account.organizations SET status = $2
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${organizationColumns}`,
    [id, status]
  );

export const audit = ({ actorId, action, entityId, before, after, ip, requestId }) =>
  run(
    "none",
    `INSERT INTO ops.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address, request_id) VALUES ($1,$2,'account.organizations',$3,$4::jsonb,$5::jsonb,$6,$7)`,
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

export const findMembership = (organizationId, userId) =>
  run(
    "oneOrNone",
    `SELECT organization_id AS "organizationId", user_id AS "userId", role, status, joined_at AS "joinedAt"
     FROM account.organization_members WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId]
  );

export const listMembers = organizationId =>
  run(
    "any",
    `SELECT u.id, u.display_name AS "name", u.phone_e164 AS "phone", u.email,
            m.role, m.status, m.joined_at AS "joinedAt"
     FROM account.organization_members m
     JOIN auth.users u ON u.id = m.user_id
     WHERE m.organization_id = $1 AND m.status <> 'INACTIVE'
     ORDER BY m.joined_at NULLS LAST, u.display_name`,
    [organizationId]
  );

export const findUserSummary = userId =>
  run(
    "oneOrNone",
    `SELECT id, display_name AS "name", phone_e164 AS "phone", email
     FROM auth.users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );

export const addMember = (organizationId, userId, role) =>
  run(
    "one",
    `INSERT INTO account.organization_members (organization_id, user_id, role, status, joined_at)
     VALUES ($1,$2,$3,'ACTIVE',now())
     ON CONFLICT (organization_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE', joined_at = now()
     RETURNING role, status, joined_at AS "joinedAt"`,
    [organizationId, userId, role]
  );

export const removeMember = (organizationId, userId) =>
  run(
    "oneOrNone",
    `UPDATE account.organization_members SET status = 'INACTIVE'
     WHERE organization_id = $1 AND user_id = $2 AND status <> 'INACTIVE'
     RETURNING user_id AS "userId"`,
    [organizationId, userId]
  );

export const countActiveOwners = organizationId =>
  run(
    "one",
    `SELECT count(*)::int AS count FROM account.organization_members
     WHERE organization_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`,
    [organizationId]
  );

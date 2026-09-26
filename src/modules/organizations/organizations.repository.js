import pg from "../../utils/postgres_store.js";

const run = async (method, sql, params = []) => {
  const result = await pg[method](sql, params);
  if (!result.ok) throw result.error;
  return result.data;
};

const runTx = async fn => {
  const result = await pg.tx(fn);
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

// Platform-wide listing for admin review — unlike listForUser above, this is
// not scoped to the caller's own memberships (no organization_members join),
// so a PENDING organization is visible here even though the public get()'s
// membership-gated visibility (organizations.service.js#get) would 404 it
// for anyone who isn't already an active member.
const listAdminFilters = `
     WHERE o.deleted_at IS NULL
       AND ($1::varchar IS NULL OR o.name ILIKE $1 OR o.slug ILIKE $1 OR o.phone ILIKE $1 OR o.email ILIKE $1 OR o.gst_number ILIKE $1 OR o.rera_number ILIKE $1)
       AND ($2::varchar IS NULL OR o.name ILIKE $2)
       AND ($3::varchar IS NULL OR o.type = $3)
       AND ($4::varchar IS NULL OR o.slug ILIKE $4)
       AND ($5::varchar IS NULL OR o.phone ILIKE $5)
       AND ($6::varchar IS NULL OR o.email ILIKE $6)
       AND ($7::varchar IS NULL OR o.gst_number ILIKE $7)
       AND ($8::varchar IS NULL OR o.rera_number ILIKE $8)
       AND ($9::varchar IS NULL OR o.status = $9)`;

const listAdminParams = ({ search, name, type, slug, phone, email, gstNumber, reraNumber, status }) => [
  search ? `%${search}%` : null,
  name ? `%${name}%` : null,
  type || null,
  slug ? `%${slug}%` : null,
  phone ? `%${phone}%` : null,
  email ? `%${email}%` : null,
  gstNumber ? `%${gstNumber}%` : null,
  reraNumber ? `%${reraNumber}%` : null,
  status || null
];

export const listAdmin = (filters, { limit, offset }) =>
  run(
    "any",
    `SELECT ${organizationColumns}, created_at AS "createdAt", created_by_user_id AS "createdByUserId",
            count(*) OVER()::int AS total
     FROM account.organizations o
     ${listAdminFilters}
     ORDER BY o.created_at DESC
     LIMIT $10 OFFSET $11`,
    [...listAdminParams(filters), limit, offset]
  );

// Admin detail lookup — same row shape as findById but exposes createdAt and
// createdByUserId (findById's organizationColumns intentionally omits these
// from the public/self-service response shape).
export const findByIdForAdmin = id =>
  run(
    "oneOrNone",
    `SELECT ${organizationColumns}, created_at AS "createdAt", created_by_user_id AS "createdByUserId"
     FROM account.organizations WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );

export const update = (id, changes) =>
  pg.updateWhere({
    table: "account.organizations",
    set: changes,
    where: "id = ${id} AND deleted_at IS NULL",
    params: { id },
    returning: organizationColumns
  });

// validStatuses gates the transition atomically in the WHERE clause (not a
// separate read-then-write) so two concurrent admin actions on the same org
// can't race past a stale status check — mirrors
// channel-partners.repository.js#setStatus. Returns null (not a thrown
// error) when the current status isn't in validStatuses, which the caller
// turns into a 409 INVALID_TRANSITION.
export const setStatus = ({ organizationId, status, validStatuses }) =>
  run(
    "oneOrNone",
    `UPDATE account.organizations SET status = $2, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL AND status = ANY($3::varchar[])
     RETURNING ${organizationColumns}`,
    [organizationId, status, validStatuses]
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
     WHERE m.organization_id = $1 AND m.status <> 'REMOVED'
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

// Matches auth.users' own unique partial index on phone_e164 (excluding
// soft-deleted rows).
export const findUserByPhone = phone =>
  run(
    "oneOrNone",
    `SELECT id, display_name AS "name", phone_e164 AS "phone", email
     FROM auth.users WHERE phone_e164 = $1 AND deleted_at IS NULL`,
    [phone]
  );

// Unverified — phone_verified_at stays NULL, unlike
// auth.repository.js#createUser (always called right after that destination's
// own OTP was just verified). Here the *inviter* typed this number, not the
// invitee, so nothing has actually verified it yet; the invitee proves it
// themselves later via their own OTP login (auth.service.js#requestOtp
// matches them by destination and attaches their existing id to the
// challenge, so verifyOtp reuses this row rather than creating a duplicate).
// ON CONFLICT DO NOTHING + null return mirrors createUser's own race-losing
// path — the caller re-looks-up by phone when this returns null.
export const createInvitedUser = ({ phone, firstName, lastName }) =>
  run(
    "oneOrNone",
    `INSERT INTO auth.users (phone_e164, first_name, last_name, display_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id, display_name AS "name", phone_e164 AS "phone", email`,
    [phone, firstName, lastName, `${firstName} ${lastName}`.trim()]
  );

// addMember and removeMember both take a per-organization advisory lock
// before reading current membership state — without it: (a) two concurrent
// operations that would each individually leave >=1 owner (e.g. two owners
// removing each other at once) could both read "count > 1" before either
// commits, leaving the organization with zero active owners and no way to
// re-grant OWNER (only an existing owner may do that); (b) two concurrent
// invites for two different new users could both read the same
// under-the-limit team-member seat count before either commits, pushing the
// org over its plan's team-member limit. Renamed from the original
// ownerCountLockKey now that this same lock also guards the team-member-seat
// check below — one lock per org covering every membership-count invariant,
// not one lock per invariant.
const organizationMembershipLockKey = organizationId => `${organizationId}:organization-membership`;

const activeOwnerCount = (t, organizationId) =>
  t.one(
    `SELECT count(*)::int AS count FROM account.organization_members
     WHERE organization_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`,
    [organizationId]
  );

// A brand-new invite (or re-inviting someone previously REMOVED) starts
// INVITED, not ACTIVE — the target must accept it themselves
// (see acceptInvite) before they're really a member. An already-ACTIVE
// member keeps their ACTIVE status and joined_at when only their role
// changes (no re-consent needed for a role change to someone already in
// the org). Re-inviting someone still INVITED just refreshes their role.
//
// teamMemberLimit (resolved by the caller via
// entitlements.service.js#resolveTeamMemberLimit, null = unlimited) is
// enforced here, inside the same locked transaction as the owner-count
// check and the insert itself — not as a pre-check in the service layer —
// so two concurrent invites for two different new users can't both pass a
// stale "under the limit" read before either commits. Only a genuinely new
// member (no existing row) consumes a seat; a role change on someone
// already in the org never does.
export const addMember = (organizationId, userId, role, { teamMemberLimit = null } = {}) =>
  runTx(async t => {
    await t.any(`SELECT pg_advisory_xact_lock(hashtext($1))`, [organizationMembershipLockKey(organizationId)]);
    const existing = await t.oneOrNone(
      `SELECT role, status FROM account.organization_members WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );
    if (existing?.role === "OWNER" && existing.status === "ACTIVE" && role !== "OWNER") {
      const owners = await activeOwnerCount(t, organizationId);
      if (owners.count <= 1) return { membership: null, reason: "LAST_OWNER" };
    }
    // A REMOVED row still counts as "existing" for the query above (it
    // matches on organization_id + user_id regardless of status), but a
    // REMOVED member holds no seat — re-inviting them is exactly as new-seat
    // -consuming as a first-time invite, and the ON CONFLICT branch below
    // reactivates them to INVITED. Treating existing?.status === "REMOVED"
    // as "not existing" here keeps that path from silently bypassing the
    // limit the seat-count query itself already excludes REMOVED rows from.
    const holdsNoSeat = !existing || existing.status === "REMOVED";
    if (holdsNoSeat && teamMemberLimit !== null) {
      // ACTIVE and INVITED both consume a seat — an outstanding invite
      // counts too, otherwise an org could out-invite its limit and win the
      // race on acceptance.
      const seats = await t.one(
        `SELECT count(*)::int AS count FROM account.organization_members
         WHERE organization_id = $1 AND status IN ('ACTIVE','INVITED')`,
        [organizationId]
      );
      if (seats.count >= teamMemberLimit) return { membership: null, reason: "TEAM_LIMIT_REACHED", used: seats.count };
    }
    const membership = await t.one(
      `INSERT INTO account.organization_members (organization_id, user_id, role, status)
       VALUES ($1,$2,$3,'INVITED')
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = EXCLUDED.role,
             status = CASE WHEN account.organization_members.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INVITED' END,
             joined_at = CASE WHEN account.organization_members.status = 'ACTIVE' THEN account.organization_members.joined_at ELSE NULL END
       RETURNING role, status, joined_at AS "joinedAt"`,
      [organizationId, userId, role]
    );
    return { membership, reason: null };
  });

// Called by the invited user themselves — the only way a membership ever
// becomes ACTIVE from INVITED (see organizations.service.js acceptMembership).
export const acceptInvite = (organizationId, userId) =>
  run(
    "oneOrNone",
    `UPDATE account.organization_members SET status = 'ACTIVE', joined_at = now()
     WHERE organization_id = $1 AND user_id = $2 AND status = 'INVITED'
     RETURNING role, status, joined_at AS "joinedAt"`,
    [organizationId, userId]
  );

export const removeMember = (organizationId, userId) =>
  runTx(async t => {
    await t.any(`SELECT pg_advisory_xact_lock(hashtext($1))`, [organizationMembershipLockKey(organizationId)]);
    const target = await t.oneOrNone(
      `SELECT role, status FROM account.organization_members WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );
    if (!target || target.status === "REMOVED") return { removed: null, reason: "NOT_FOUND" };
    if (target.role === "OWNER" && target.status === "ACTIVE") {
      const owners = await activeOwnerCount(t, organizationId);
      if (owners.count <= 1) return { removed: null, reason: "LAST_OWNER" };
    }
    const removed = await t.one(
      `UPDATE account.organization_members SET status = 'REMOVED'
       WHERE organization_id = $1 AND user_id = $2 RETURNING user_id AS "userId"`,
      [organizationId, userId]
    );
    return { removed, reason: null };
  });

// Admin-only generic status setter — unlike removeMember above (self-service,
// ACTIVE/INVITED -> REMOVED only, gated on the org's own OWNER/ADMIN), this
// allows any existing row to move to any of the 3 valid statuses, including
// REMOVED -> ACTIVE/INVITED (reactivation with no fresh invite-accept cycle,
// and deliberately not re-checked against the plan's team-member seat limit
// the way addMember's own REMOVED -> INVITED re-invite path is — this is an
// admin override, not a self-service seat purchase). Still enforces the one
// invariant that must hold no matter who's acting: an org can't be left with
// zero active owners.
export const setMemberStatus = (organizationId, userId, status) =>
  runTx(async t => {
    await t.any(`SELECT pg_advisory_xact_lock(hashtext($1))`, [organizationMembershipLockKey(organizationId)]);
    const before = await t.oneOrNone(
      `SELECT role, status FROM account.organization_members WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId]
    );
    if (!before) return { membership: null, before: null, reason: "NOT_FOUND" };
    if (before.role === "OWNER" && before.status === "ACTIVE" && status !== "ACTIVE") {
      const owners = await activeOwnerCount(t, organizationId);
      if (owners.count <= 1) return { membership: null, before, reason: "LAST_OWNER" };
    }
    const membership = await t.one(
      `UPDATE account.organization_members
       SET status = $3, joined_at = CASE WHEN $3 = 'ACTIVE' AND joined_at IS NULL THEN now() ELSE joined_at END
       WHERE organization_id = $1 AND user_id = $2
       RETURNING role, status, joined_at AS "joinedAt"`,
      [organizationId, userId, status]
    );
    return { membership, before, reason: null };
  });

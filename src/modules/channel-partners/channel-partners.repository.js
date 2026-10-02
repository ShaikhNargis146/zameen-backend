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
    [status, locationId, search ? `%${search}%` : null, limit, offset]
  );

// A REJECTED applicant gets no way back in without this: user_id is the
// table's PRIMARY KEY, so a plain INSERT hits a unique violation and
// mapReferenceError turns that into 409 ALREADY_APPLIED forever, with no
// REJECTED -> PENDING transition anywhere and no re-apply endpoint. The
// ON CONFLICT here re-opens a REJECTED profile as a fresh PENDING
// application (clearing the prior approval fields); a conflict on any
// other status (already PENDING/APPROVED/SUSPENDED) is left untouched by
// the WHERE clause, and the null RETURNING is turned back into the same
// 23505 mapReferenceError already maps to ALREADY_APPLIED, so that case is
// unchanged.
export const createProfile = ({ userId, organizationId, reraNumber, experienceYears, about, locationIds }) =>
  runTx(async t => {
    const result = await t.oneOrNone(
      `INSERT INTO account.channel_partner_profiles (user_id, organization_id, rera_number, about, experience_years)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         rera_number = EXCLUDED.rera_number,
         about = EXCLUDED.about,
         experience_years = EXCLUDED.experience_years,
         status = 'PENDING',
         approved_at = NULL,
         approved_by_user_id = NULL,
         updated_at = now()
       WHERE account.channel_partner_profiles.status = 'REJECTED'
       RETURNING user_id`,
      [userId, organizationId, reraNumber, about, experienceYears]
    );
    if (!result) {
      const alreadyApplied = new Error("A channel partner application already exists for this user.");
      alreadyApplied.code = "23505";
      throw alreadyApplied;
    }
    // Re-applying replaces the location set rather than adding to the
    // REJECTED profile's old one — otherwise re-inserting a location the
    // applicant kept from before would hit the composite PK.
    await t.none(`DELETE FROM account.channel_partner_locations WHERE channel_partner_user_id = $1`, [userId]);
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

// Ensures an approved channel partner is also a real ACTIVE
// account.organization_members row (role MEMBER), not just a
// channel_partner_profiles link — organization_members is what every
// entitlement/authorization check in this codebase actually reads
// (property/listing ownership, org-scoped purchases, an explicit
// organizationId on an AI request, etc.), not channel_partner_profiles.
// (AI quota specifically is never auto-pooled from mere membership — see
// ai.service.js#resolveOrganizationContext — but this membership is still
// what makes an explicit organizationId, or a request about an org-owned
// resource, resolve correctly for a channel partner too.) ACTIVE (not
// INVITED): approval is itself the
// consent step here, so there's no separate accept-invite flow to run a
// channel partner through. ON CONFLICT DO NOTHING: never overwrites an
// existing membership row of any status — an org admin's own prior explicit
// REMOVED (or OWNER/ADMIN) for this user is left untouched, not silently
// downgraded or reactivated. Mirrors
// migrations/017_channel_partner_membership_backfill.sql's one-time
// backfill for every channel partner approved from here on.
export const ensureOrganizationMembership = (organizationId, userId) =>
  run(
    "none",
    `INSERT INTO account.organization_members (organization_id, user_id, role, status, joined_at)
     VALUES ($1,$2,'MEMBER','ACTIVE', now())
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [organizationId, userId]
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

import { pg, run } from "../../shared/db.js";

const checkColumns = `c.id, c.property_id AS "propertyId", c.check_type AS "checkType", c.status,
  c.requested_at AS "requestedAt", c.reviewed_at AS "reviewedAt", c.notes AS "publicNote",
  p.public_code AS "propertyCode", p.created_by_user_id AS "propertyOwnerId"`;

const where = `WHERE ($1::varchar IS NULL OR c.status = $1)
  AND ($2::varchar IS NULL OR c.check_type = $2)
  AND ($3::varchar IS NULL OR p.public_code ILIKE $3 OR owner.display_name ILIKE $3)`;

export const list = ({ status, checkType, search, limit, offset }) =>
  run(
    "any",
    `SELECT ${checkColumns}, count(*) OVER()::int AS total
     FROM land.property_verification_checks c
     JOIN land.properties p ON p.id = c.property_id AND p.deleted_at IS NULL
     LEFT JOIN auth.users owner ON owner.id = p.created_by_user_id
     ${where}
     ORDER BY c.requested_at DESC NULLS LAST, c.created_at DESC LIMIT $4 OFFSET $5`,
    [status, checkType, search ? `%${search}%` : null, limit, offset]
  );
export const find = verificationId =>
  run(
    "oneOrNone",
    `SELECT ${checkColumns}, requester.display_name AS "requesterName", requester.phone_e164 AS "requesterPhone", requester.email AS "requesterEmail"
     FROM land.property_verification_checks c
     JOIN land.properties p ON p.id = c.property_id AND p.deleted_at IS NULL
     LEFT JOIN auth.users requester ON requester.id = c.requested_by_user_id
     WHERE c.id = $1`,
    [verificationId]
  );
export const propertyDocuments = propertyId =>
  run(
    "any",
    `SELECT d.id, d.file_name AS "fileName", d.mime_type AS "mimeType", d.file_size_bytes AS "fileSizeBytes",
       d.visibility, d.verification_status AS "verificationStatus", d.created_at AS "createdAt",
       dt.code AS "documentTypeCode", dt.name AS "documentTypeName"
     FROM land.property_documents d JOIN land.document_types dt ON dt.id = d.document_type_id
     WHERE d.property_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`,
    [propertyId]
  );
export const internalNotes = verificationId =>
  run(
    "any",
    `SELECT audit.id, audit.after_data->>'internalNote' AS note,
       audit.created_at AS "createdAt", actor.id AS "actorId",
       actor.display_name AS "actorDisplayName"
     FROM ops.audit_logs audit
     LEFT JOIN auth.users actor ON actor.id = audit.actor_user_id
     WHERE audit.entity_type = 'land.property_verification_checks'
       AND audit.entity_id = $1
       AND NULLIF(audit.after_data->>'internalNote', '') IS NOT NULL
     ORDER BY audit.created_at DESC`,
    [verificationId]
  );
export const propertyChecks = propertyId =>
  run(
    "any",
    `SELECT check_type AS "checkType", status, reviewed_at AS "reviewedAt", notes AS "publicNote", updated_at AS "updatedAt"
     FROM land.property_verification_checks WHERE property_id = $1 ORDER BY check_type`,
    [propertyId]
  );
export const propertyChecksForProperties = propertyIds =>
  propertyIds.length
    ? run(
        "any",
        `SELECT property_id AS "propertyId", check_type AS "checkType", status,
           reviewed_at AS "reviewedAt", requested_at AS "requestedAt",
           notes AS "publicNote", updated_at AS "updatedAt"
         FROM land.property_verification_checks
         WHERE property_id = ANY($1::uuid[]) ORDER BY property_id, check_type`,
        [propertyIds]
      )
    : Promise.resolve([]);
export const updateWithAudit = ({
  verificationId,
  checkType,
  status,
  publicNote,
  internalNote,
  actorId,
  before,
  ip,
  requestId
}) =>
  pg.tx(async transaction => {
    const updated = await transaction.oneOrNone(
      `UPDATE land.property_verification_checks
       SET status = $3, notes = $4, internal_notes = $5,
           reviewed_by_user_id = $6, reviewed_at = now()
       WHERE id = $1 AND check_type = $2
       RETURNING id`,
      [verificationId, checkType, status, publicNote, internalNote, actorId]
    );
    if (!updated) return null;
    await transaction.none(
      `INSERT INTO ops.audit_logs (actor_user_id, action, entity_type, entity_id, before_data, after_data, ip_address, request_id)
       VALUES ($1,'VERIFICATION_UPDATED','land.property_verification_checks',$2,$3::jsonb,$4::jsonb,$5,$6)`,
      [
        actorId,
        verificationId,
        JSON.stringify(before),
        JSON.stringify({ checkType, status, publicNote, internalNote }),
        ip || null,
        requestId || null
      ]
    );
    return updated;
  });

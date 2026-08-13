import { HttpError } from "../../shared/http.js";
import * as repository from "./verification.repository.js";

const summary = async propertyId => {
  const checks = await repository.propertyChecks(propertyId);
  const statuses = checks.map(check => check.status);
  const overallStatus = statuses.includes("REJECTED")
    ? "REJECTED"
    : statuses.includes("PARTIAL")
    ? "PARTIAL"
    : statuses.length && statuses.every(status => status === "VERIFIED")
    ? "VERIFIED"
    : statuses.includes("PENDING")
    ? "PENDING"
    : "NOT_STARTED";
  const timestamps = checks
    .map(check => check.updatedAt)
    .filter(Boolean)
    .sort();
  return {
    propertyId,
    overallStatus,
    checks,
    lastUpdatedAt: timestamps.at(-1) || null
  };
};
const detail = async verification => ({
  id: verification.id,
  summary: await summary(verification.propertyId),
  property: {
    id: verification.propertyId,
    publicCode: verification.propertyCode
  },
  documents: await repository.propertyDocuments(verification.propertyId),
  internalNotes: [],
  requestedAt: verification.requestedAt,
  requestedBy: verification.requesterName
    ? {
        id: verification.propertyOwnerId,
        displayName: verification.requesterName,
        phoneE164: verification.requesterPhone,
        email: verification.requesterEmail
      }
    : null
});

export const list = async filters => {
  const offset = (filters.page - 1) * filters.limit;
  const rows = await repository.list({ ...filters, offset });
  const total = rows[0]?.total || 0;
  return {
    data: await Promise.all(
      rows.map(async ({ total: ignored, ...row }) => ({
        ...(await summary(row.propertyId)),
        verificationId: row.id
      }))
    ),
    meta: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit)
    }
  };
};
export const get = async verificationId => {
  const verification = await repository.find(verificationId);
  if (!verification)
    throw new HttpError(
      404,
      "VERIFICATION_NOT_FOUND",
      "Verification was not found."
    );
  return detail(verification);
};
export const update = async ({ verificationId, actorId, changes, request }) => {
  const before = await repository.find(verificationId);
  if (!before)
    throw new HttpError(
      404,
      "VERIFICATION_NOT_FOUND",
      "Verification was not found."
    );
  if (before.checkType !== changes.checkType)
    throw new HttpError(
      400,
      "CHECK_TYPE_MISMATCH",
      "checkType does not match this verification record."
    );
  const result = await repository.update({
    verificationId,
    actorId,
    ...changes
  });
  if (!result.ok) throw result.error;
  await repository.audit({
    actorId,
    verificationId,
    before,
    after: changes,
    ...request
  });
  return get(verificationId);
};

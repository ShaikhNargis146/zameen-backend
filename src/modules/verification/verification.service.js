import { HttpError } from "../../shared/http.js";
import { verificationSummaryForChecks } from "../../shared/verification.js";
import * as repository from "./verification.repository.js";

const summary = async propertyId => {
  const checks = await repository.propertyChecks(propertyId);
  return verificationSummaryForChecks(propertyId, checks);
};
const detail = async verification => ({
  id: verification.id,
  summary: await summary(verification.propertyId),
  property: {
    id: verification.propertyId,
    publicCode: verification.propertyCode
  },
  documents: await repository.propertyDocuments(verification.propertyId),
  internalNotes: await repository.internalNotes(verification.id),
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
  const checks = await repository.propertyChecksForProperties(
    rows.map(row => row.propertyId)
  );
  const checksByProperty = new Map();
  for (const check of checks) {
    const existing = checksByProperty.get(check.propertyId) || [];
    existing.push(check);
    checksByProperty.set(check.propertyId, existing);
  }
  return {
    data: rows.map(({ total: ignored, ...row }) => ({
      ...verificationSummaryForChecks(
        row.propertyId,
        checksByProperty.get(row.propertyId) || []
      ),
      verificationId: row.id
    })),
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
  const result = await repository.updateWithAudit({
    verificationId,
    actorId,
    ...changes,
    before,
    ...request
  });
  if (!result.ok) throw result.error;
  if (!result.data)
    throw new HttpError(
      409,
      "VERIFICATION_UPDATE_CONFLICT",
      "The verification changed before this update could be applied."
    );
  return get(verificationId);
};

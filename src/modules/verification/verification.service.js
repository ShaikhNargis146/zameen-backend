import { HttpError } from "../../shared/http.js";
import { verificationSummaryForChecks } from "../../shared/verification.js";
import * as notifications from "../notifications/notifications.service.js";
import * as repository from "./verification.repository.js";

const summary = async propertyId => {
  const checks = await repository.propertyChecks(propertyId);
  return verificationSummaryForChecks(propertyId, checks);
};
const detail = async verification => ({
  id: verification.id,
  // `id` identifies this specific check. The summary exposes the IDs for all
  // sibling checks so an admin UI can update LAND_DETAILS, LOCATION, etc.
  // without reusing the current record's ID.
  checkType: verification.checkType,
  status: verification.status,
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

export const verificationQueuePresentation = rows =>
  rows.map(({ total: ignored, ...row }) => ({
    id: row.id,
    checkType: row.checkType,
    status: row.status,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt,
    publicNote: row.publicNote,
    property: {
      id: row.propertyId,
      publicCode: row.propertyCode
    }
  }));

export const canReviewVerification = status => status === "PENDING";

export const list = async filters => {
  const offset = (filters.page - 1) * filters.limit;
  const rows = await repository.list({ ...filters, offset });
  const total = rows[0]?.total || 0;
  return {
    data: verificationQueuePresentation(rows),
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
  if (changes.checkType && before.checkType !== changes.checkType)
    throw new HttpError(
      400,
      "CHECK_TYPE_MISMATCH",
      "checkType does not match this verification record."
    );
  if (!canReviewVerification(before.status))
    throw new HttpError(
      409,
      "VERIFICATION_NOT_PENDING",
      "Only a pending verification check can be reviewed."
    );
  const result = await repository.updateWithAudit({
    verificationId,
    actorId,
    ...changes,
    checkType: before.checkType,
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
  await notifications.notifyUser(before.propertyOwnerId, {
    type: "VERIFICATION_UPDATED",
    title: "Verification status updated",
    body: `Your ${before.checkType} verification is now ${changes.status}.`,
    data: {
      verificationId,
      checkType: before.checkType,
      status: changes.status
    }
  });
  return get(verificationId);
};

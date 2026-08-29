import { randomUUID } from "node:crypto";
import { HttpError } from "../../shared/http.js";
import { scannerPresentation } from "../../shared/scanner.js";
import {
  belongsToProperty,
  createStorageKey,
  signedReadUrl,
  signedWriteUrl
} from "../../utils/storage.js";
import { verificationSummaryForChecks } from "../../shared/verification.js";
import * as repository from "./properties.repository.js";

const propertyCode = () =>
  `ZMN-P-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .toUpperCase()}`;
export const ownedProperty = async (propertyId, actorId) => {
  const property = await repository.findOwned(propertyId, actorId);
  if (!property)
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property was not found.");
  return property;
};
export const propertyForAdmin = async propertyId => {
  const property = await repository.summary(propertyId);
  if (!property)
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property was not found.");
  return property;
};
export const viewableProperty = async (propertyId, actorId = null) => {
  const owned = actorId
    ? await repository.findOwned(propertyId, actorId)
    : null;
  const property = owned || (await repository.findPublic(propertyId));
  if (!property)
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property was not found.");
  return property;
};
export const create = async ({ actorId, input }) => {
  if (
    input.organizationId &&
    !(await repository.activeOrganizationMembership(
      input.organizationId,
      actorId
    ))
  )
    throw new HttpError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "You are not an active member of that organisation."
    );
  let saved;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        saved = await repository.createProperty({
          ...input,
          userId: actorId,
          publicCode: propertyCode()
        });
        break;
      } catch (error) {
        if (error?.code !== "23505" || attempt === 2) throw error;
      }
    }
    return repository.summary(saved.id);
  } catch (error) {
    if (error?.code === "23503")
      throw new HttpError(
        400,
        "INVALID_MASTER_REFERENCE",
        "A selected master value does not exist."
      );
    throw error;
  }
};
export const get = propertyId => repository.summary(propertyId);
export const remove = propertyId => repository.archive(propertyId);
export const listMine = async ({ actorId, input }) => {
  const offset = (input.page - 1) * input.limit;
  const [ids, count] = await Promise.all([
    repository.ownedIds({ ...input, userId: actorId, offset }),
    repository.countOwned({ ...input, userId: actorId })
  ]);
  return {
    items: await repository.summaries(ids.map(row => row.id)),
    total: count.total
  };
};
export const update = async ({ propertyId, changes }) => {
  const result = await repository.update(propertyId, changes);
  if (!result.ok) {
    if (result.error?.code === "23503")
      throw new HttpError(
        400,
        "INVALID_MASTER_REFERENCE",
        "A selected master value does not exist."
      );
    throw result.error;
  }
  if (!result.data)
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property was not found.");
  return repository.summary(propertyId);
};
export const getLandDetails = repository.landDetails;
export const saveLandDetails = async ({ propertyId, input }) => {
  const unit = await repository.areaUnit(input.areaUnitId);
  if (!unit)
    throw new HttpError(400, "INVALID_AREA_UNIT", "areaUnitId is invalid.");
  await repository.saveLandDetails({
    ...input,
    propertyId,
    areaSqft: input.areaValue * Number(unit.sqft_multiplier)
  });
  return repository.landDetails(propertyId);
};
export const getLocation = repository.location;
export const saveLocation = async ({ propertyId, input }) => {
  const postal = input.pincode
    ? await repository.postalCode(input.pincode)
    : null;
  if (input.pincode && !postal)
    throw new HttpError(400, "INVALID_PINCODE", "pincode is not configured.");
  await repository.saveLocation({
    ...input,
    propertyId,
    postalCodeId: postal?.id || null
  });
  return repository.location(propertyId);
};
export const getAmenities = repository.amenities;
export const saveAmenities = async ({ propertyId, amenities }) => {
  await repository.replaceAmenities(propertyId, amenities);
  return repository.amenities(propertyId);
};
export const getIdentifiers = repository.identifiers;
export const saveIdentifiers = async ({ propertyId, identifiers }) => {
  const configuredTypes = await repository.identifierTypesForProperty(
    propertyId
  );
  if (!configuredTypes.length)
    throw new HttpError(
      409,
      "PARCEL_CONFIG_UNAVAILABLE",
      "Parcel identifiers are not configured for this property's state."
    );
  const configuredTypesByCode = new Map(
    configuredTypes.map(type => [type.code, type])
  );
  const resolvedIdentifiers = identifiers.map(identifier => ({
    ...identifier,
    identifierTypeId: configuredTypesByCode.get(identifier.type)?.id
  }));
  if (resolvedIdentifiers.some(identifier => !identifier.identifierTypeId))
    throw new HttpError(
      400,
      "INVALID_IDENTIFIERS",
      "One or more identifier types are not configured for this property's state."
    );
  await repository.replaceIdentifiers(propertyId, resolvedIdentifiers);
  return repository.identifiers(propertyId);
};
export const requestVerification = async ({
  propertyId,
  actorId,
  checkTypes,
  note = null
}) => {
  await repository.requestVerification({
    propertyId,
    userId: actorId,
    checkTypes,
    note
  });
  return verificationSummary(propertyId);
};
export const verificationSummary = async propertyId => {
  const checks = await repository.verification(propertyId);
  return verificationSummaryForChecks(propertyId, checks);
};
export const scanner = async propertyId => {
  const result = await repository.scanner(propertyId);
  return scannerPresentation({
    propertyId,
    readinessScore: result?.readinessScore || 0,
    missingItems: result?.missingItems || [
      "Land details",
      "Property location",
      "Parcel identifier",
      "Property document",
      "Property media"
    ]
  });
};
export const passport = async propertyId => {
  const result = await repository.passport(propertyId);
  if (!result) return { propertyId };
  const scannerResult = await repository.scanner(propertyId);
  const checks = result.verificationChecks || {};
  const values = Object.values(checks);
  const overallVerificationStatus = values.includes("REJECTED")
    ? "REJECTED"
    : values.includes("PARTIAL")
    ? "PARTIAL"
    : values.length && values.every(value => value === "VERIFIED")
    ? "VERIFIED"
    : values.includes("PENDING")
    ? "PENDING"
    : "NOT_STARTED";
  return {
    propertyId: result.propertyId,
    passportCode: result.publicCode,
    sellerVerification: result.sellerVerification,
    locationVerification: checks.LOCATION || "NOT_STARTED",
    parcelInformationAvailable: !(scannerResult?.missingItems || []).includes(
      "Parcel identifier"
    ),
    documentCount: Number(result.documentCount),
    verifiedDocumentCount: result.verifiedDocumentCount,
    propertyCompletionPercent: result.completenessPercent,
    overallVerificationStatus,
    lastVerifiedAt: result.lastVerifiedAt
  };
};
const mediaResponse = async item => ({
  ...item,
  url: await signedReadUrl(item.storageKey),
  thumbnailUrl: await signedReadUrl(item.thumbnailStorageKey)
});
const documentResponse = async (item, includeDownload = false) => ({
  ...item,
  ...(includeDownload
    ? { downloadUrl: await signedReadUrl(item.storageKey) }
    : { downloadUrl: null })
});
export const createMediaUpload = ({ propertyId, input }) =>
  signedWriteUrl({
    storageKey: createStorageKey({
      propertyId,
      category: "media",
      fileName: input.fileName
    }),
    mimeType: input.mimeType
  });
export const completeMedia = async ({ propertyId, actorId, input }) => {
  if (
    !belongsToProperty({
      propertyId,
      category: "media",
      storageKey: input.storageKey
    })
  )
    throw new HttpError(
      400,
      "INVALID_STORAGE_KEY",
      "storageKey does not belong to this property upload."
    );
  const saved = await repository.createMedia({
    ...input,
    isCover: false,
    propertyId,
    userId: actorId
  });
  if (input.isCover) await repository.setCover(propertyId, saved.id);
  return mediaResponse(
    (await repository.media(propertyId)).find(item => item.id === saved.id)
  );
};
export const listMedia = async propertyId =>
  Promise.all((await repository.media(propertyId)).map(mediaResponse));
export const updateMedia = async ({ propertyId, mediaId, changes }) => {
  if (!(await repository.mediaForProperty(propertyId, mediaId)))
    throw new HttpError(404, "MEDIA_NOT_FOUND", "Media was not found.");
  const result = await repository.updateMedia(mediaId, changes);
  if (!result.ok) throw result.error;
  if (!result.data)
    throw new HttpError(404, "MEDIA_NOT_FOUND", "Media was not found.");
  return mediaResponse(
    (await repository.media(propertyId)).find(item => item.id === mediaId)
  );
};
export const deleteMedia = async ({ propertyId, mediaId }) => {
  if (!(await repository.mediaForProperty(propertyId, mediaId)))
    throw new HttpError(404, "MEDIA_NOT_FOUND", "Media was not found.");
  await repository.deleteMedia(mediaId);
};
export const reorderMedia = async ({ propertyId, mediaIds }) => {
  const current = await repository.media(propertyId);
  if (
    current.length !== mediaIds.length ||
    current.some(item => !mediaIds.includes(item.id))
  )
    throw new HttpError(
      400,
      "INVALID_MEDIA_ORDER",
      "mediaIds must contain every property media item exactly once."
    );
  await repository.reorderMedia(propertyId, mediaIds);
  return listMedia(propertyId);
};
export const setMediaCover = async ({ propertyId, mediaId }) => {
  if (!(await repository.mediaForProperty(propertyId, mediaId)))
    throw new HttpError(404, "MEDIA_NOT_FOUND", "Media was not found.");
  await repository.setCover(propertyId, mediaId);
  return listMedia(propertyId);
};
export const createDocumentUpload = ({ propertyId, input }) =>
  signedWriteUrl({
    storageKey: createStorageKey({
      propertyId,
      category: "documents",
      fileName: input.fileName
    }),
    mimeType: input.mimeType
  });
export const completeDocument = async ({ propertyId, actorId, input }) => {
  if (
    !belongsToProperty({
      propertyId,
      category: "documents",
      storageKey: input.storageKey
    })
  )
    throw new HttpError(
      400,
      "INVALID_STORAGE_KEY",
      "storageKey does not belong to this property upload."
    );
  try {
    const saved = await repository.createDocument({
      ...input,
      propertyId,
      userId: actorId
    });
    return documentResponse(
      await repository.document(propertyId, saved.id),
      true
    );
  } catch (error) {
    if (error?.code === "23503")
      throw new HttpError(
        400,
        "INVALID_DOCUMENT_TYPE",
        "documentTypeId is invalid."
      );
    throw error;
  }
};
export const listDocuments = async propertyId =>
  Promise.all(
    (await repository.documents(propertyId)).map(item =>
      documentResponse(item, true)
    )
  );
export const canReadDocument = ({ document, isOwner, isAdmin, hasGrant }) =>
  isAdmin || isOwner || (document.visibility === "APPROVED_BUYERS" && hasGrant);
export const getDocument = async ({ propertyId, documentId, actor }) => {
  const item = await repository.document(propertyId, documentId);
  if (!item)
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document was not found.");
  const isAdmin = actor.roles?.includes("ADMIN") || false;
  const isOwner = isAdmin
    ? false
    : Boolean(await repository.findOwned(propertyId, actor.id));
  const hasGrant =
    !isAdmin && !isOwner && item.visibility === "APPROVED_BUYERS"
      ? Boolean(
          await repository.hasActiveDocumentAccessGrant(documentId, actor.id)
        )
      : false;
  if (!canReadDocument({ document: item, isOwner, isAdmin, hasGrant }))
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document was not found.");
  if (isAdmin)
    await repository.auditAdminDocumentRead({
      actorId: actor.id,
      documentId,
      propertyId
    });
  return documentResponse(item, true);
};
const documentGrantResponse = grant => ({
  id: grant.id,
  grantee: {
    id: grant.granteeUserId,
    displayName: grant.granteeDisplayName
  },
  expiresAt: grant.expiresAt,
  createdAt: grant.createdAt
});
const requireGrantableDocument = async ({ propertyId, documentId }) => {
  const item = await repository.document(propertyId, documentId);
  if (!item)
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document was not found.");
  if (item.visibility !== "APPROVED_BUYERS")
    throw new HttpError(
      409,
      "DOCUMENT_GRANT_NOT_APPLICABLE",
      "Access grants are available only for APPROVED_BUYERS documents."
    );
  return item;
};
export const listDocumentAccessGrants = async ({ propertyId, documentId }) => {
  await requireGrantableDocument({ propertyId, documentId });
  return (await repository.documentAccessGrants(documentId)).map(
    documentGrantResponse
  );
};
export const grantDocumentAccess = async ({
  propertyId,
  documentId,
  actorId,
  input
}) => {
  await requireGrantableDocument({ propertyId, documentId });
  if (!(await repository.eligibleDocumentGrantee(input.granteeUserId)))
    throw new HttpError(
      400,
      "INVALID_DOCUMENT_GRANTEE",
      "granteeUserId must identify an active buyer."
    );
  const saved = await repository.upsertDocumentAccessGrant({
    documentId,
    grantedByUserId: actorId,
    ...input
  });
  const grant = await repository.documentAccessGrant(documentId, saved.id);
  await repository.auditDocumentAccessGrant({
    actorId,
    action: "DOCUMENT_ACCESS_GRANTED",
    documentId,
    data: {
      propertyId,
      granteeUserId: input.granteeUserId,
      expiresAt: input.expiresAt
    }
  });
  return documentGrantResponse(grant);
};
export const revokeDocumentAccess = async ({
  propertyId,
  documentId,
  grantId,
  actorId
}) => {
  await requireGrantableDocument({ propertyId, documentId });
  const grant = await repository.documentAccessGrant(documentId, grantId);
  if (!grant)
    throw new HttpError(
      404,
      "DOCUMENT_ACCESS_GRANT_NOT_FOUND",
      "Document access grant was not found."
    );
  if (!(await repository.revokeDocumentAccessGrant(grantId)))
    throw new HttpError(
      404,
      "DOCUMENT_ACCESS_GRANT_NOT_FOUND",
      "Document access grant was not found."
    );
  await repository.auditDocumentAccessGrant({
    actorId,
    action: "DOCUMENT_ACCESS_REVOKED",
    documentId,
    data: { propertyId, granteeUserId: grant.granteeUserId }
  });
};
export const deleteDocument = async ({ propertyId, documentId }) => {
  if (!(await repository.document(propertyId, documentId)))
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document was not found.");
  await repository.deleteDocument(documentId);
};

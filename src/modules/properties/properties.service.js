import { randomUUID } from "crypto";
import { HttpError } from "../../shared/http.js";
import {
  belongsToProperty,
  createStorageKey,
  signedReadUrl,
  signedWriteUrl
} from "../../utils/storage.js";
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
  try {
    const saved = await repository.createProperty({
      ...input,
      userId: actorId,
      publicCode: propertyCode()
    });
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
  try {
    await repository.replaceIdentifiers(propertyId, identifiers);
  } catch (error) {
    if (error?.message?.includes("Parcel identifier type"))
      throw new HttpError(400, "INVALID_IDENTIFIERS", error.message);
    throw error;
  }
  return repository.identifiers(propertyId);
};
export const requestVerification = async ({
  propertyId,
  actorId,
  checkTypes
}) => {
  await repository.requestVerification({
    propertyId,
    userId: actorId,
    checkTypes
  });
  return verificationSummary(propertyId);
};
export const verificationSummary = async propertyId => {
  const checks = await repository.verification(propertyId);
  const statuses = checks.map(check => check.status);
  const overallStatus = statuses.includes("REJECTED")
    ? "REJECTED"
    : statuses.length && statuses.every(status => status === "VERIFIED")
    ? "VERIFIED"
    : statuses.includes("PARTIAL") || statuses.includes("VERIFIED")
    ? "PARTIAL"
    : statuses.includes("PENDING")
    ? "PENDING"
    : "NOT_STARTED";
  return {
    propertyId,
    overallStatus,
    checks,
    lastUpdatedAt: checks.reduce(
      (latest, check) =>
        !latest || (check.reviewedAt || check.requestedAt) > latest
          ? check.reviewedAt || check.requestedAt
          : latest,
      null
    )
  };
};
export const scanner = async propertyId =>
  (await repository.scanner(propertyId)) || {
    propertyId,
    readinessScore: 0,
    missingItems: []
  };
export const passport = async propertyId =>
  (await repository.passport(propertyId)) || { propertyId };
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
export const getDocument = async ({ propertyId, documentId }) => {
  const item = await repository.document(propertyId, documentId);
  if (!item)
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document was not found.");
  return documentResponse(item, true);
};
export const deleteDocument = async ({ propertyId, documentId }) => {
  if (!(await repository.document(propertyId, documentId)))
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document was not found.");
  await repository.deleteDocument(documentId);
};

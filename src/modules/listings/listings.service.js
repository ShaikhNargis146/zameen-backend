import { randomUUID } from "node:crypto";
import { HttpError } from "../../shared/http.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import { signedReadUrl } from "../../utils/storage.js";
import {
  ownedProperty,
  passport as propertyPassport,
  scanner as propertyScanner,
  verificationSummary
} from "../properties/properties.service.js";
import * as repository from "./listings.repository.js";

const listingCode = () =>
  `ZMN-L-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .toUpperCase()}`;
export const ownedListing = async (listingId, actorId) => {
  const listing = await repository.findOwned(listingId, actorId);
  if (!listing)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  return listing;
};
export const listingForAdmin = async listingId => {
  const listing = await repository.findAny(listingId);
  if (!listing)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  return listing;
};
export const create = async ({ propertyId, actorId, input }) => {
  const property = await ownedProperty(propertyId, actorId);
  if (!property)
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property was not found.");
  if (
    input.organizationId &&
    !(await repository.organizationMembership(input.organizationId, actorId))
  )
    throw new HttpError(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "You are not an active member of that organisation."
    );
  if (await repository.liveListingForProperty(property.id))
    throw new HttpError(
      409,
      "LIVE_LISTING_EXISTS",
      "This property already has a live listing. Update or withdraw it before creating another."
    );
  let saved;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      saved = await repository.create({
        ...input,
        propertyId: property.id,
        userId: actorId,
        listingCode: listingCode()
      });
      break;
    } catch (error) {
      if (error?.code !== "23505" || attempt === 2) throw error;
    }
  }
  return repository.summary(saved.id);
};
export const summary = repository.summary;
export const update = async ({ listing, changes }) => {
  if (!["DRAFT", "REJECTED"].includes(listing.review_status))
    throw new HttpError(
      409,
      "LISTING_LOCKED",
      "Only draft or rejected listings may be edited."
    );
  const result = await repository.update(listing.id, changes);
  if (!result.ok) throw result.error;
  if (!result.data)
    throw new HttpError(
      409,
      "LISTING_UPDATE_CONFLICT",
      "The listing changed before this update could be applied."
    );
  return repository.summary(listing.id);
};
export const remove = async listing => {
  if (listing.status === "PUBLISHED")
    throw new HttpError(
      409,
      "WITHDRAW_LISTING_FIRST",
      "Published listings must be withdrawn before deletion."
    );
  if (!(await repository.archive(listing.id)))
    throw new HttpError(
      409,
      "LISTING_DELETE_CONFLICT",
      "The listing changed before it could be deleted."
    );
};
export const submit = async listing => {
  if (!["DRAFT", "REJECTED"].includes(listing.review_status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Listing cannot be submitted from its current state."
    );
  const scanner = await propertyScanner(listing.property_id);
  if (scanner.readinessScore < 100)
    throw new HttpError(
      409,
      "LISTING_NOT_READY",
      "Complete the required land, location, parcel, document, and media details before submitting this listing.",
      scanner.missingItems
    );
  let submitted;
  try {
    submitted = await repository.submit(listing.id);
  } catch (error) {
    if (error?.code === "23505")
      throw new HttpError(
        409,
        "LIVE_LISTING_EXISTS",
        "This property already has a live listing."
      );
    throw error;
  }
  if (!submitted)
    throw new HttpError(
      409,
      "LISTING_SUBMIT_CONFLICT",
      "The listing changed before it could be submitted."
    );
  return repository.summary(listing.id);
};
const transitions = {
  pause: { valid: ["PUBLISHED"], status: "PAUSED", action: "be paused" },
  resume: {
    valid: ["PAUSED", "INACTIVE"],
    status: "PUBLISHED",
    action: "be resumed",
    approved: true,
    published: true
  },
  withdraw: {
    valid: ["INACTIVE", "PAUSED", "PUBLISHED"],
    status: "WITHDRAWN",
    action: "be withdrawn"
  },
  sold: {
    valid: ["PUBLISHED", "PAUSED"],
    status: "SOLD",
    action: "be marked sold",
    sold: true
  }
};
export const transition = async ({
  listing,
  action,
  actorId,
  reason = null
}) => {
  const rule = transitions[action];
  if (!rule.valid.includes(listing.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      `Listing cannot ${rule.action} from its current state.`
    );
  if (rule.approved && listing.review_status !== "APPROVED")
    throw new HttpError(
      409,
      "LISTING_NOT_APPROVED",
      "Only approved listings may be published."
    );
  const updatedTransition = await repository.transition({
    id: listing.id,
    status: rule.status,
    validStatuses: rule.valid,
    requiresApproval: Boolean(rule.approved),
    setPublishedAt: rule.published,
    setSoldAt: rule.sold
  });
  if (!updatedTransition)
    throw new HttpError(
      409,
      "LISTING_TRANSITION_CONFLICT",
      "The listing changed before this transition could be applied."
    );
  const updated = await repository.summary(listing.id);
  await repository.audit({
    actorId,
    action: `LISTING_${action.toUpperCase()}`,
    listingId: listing.id,
    before: listing,
    after: updated,
    note: reason
  });
  return reason ? { ...updated, actionReason: reason } : updated;
};
export const sellerListings = async input => {
  const rows = await repository.sellerListings(input);
  const total = rows[0]?.total || 0;
  const cards = await listingCardsByIds(
    rows.map(row => row.id),
    input.userId,
    true
  );
  const cardsById = new Map(cards.map(card => [card.listingId, card]));
  return {
    items: rows.map(({ total: ignored, ...row }) => ({
      ...cardsById.get(row.id),
      reviewStatus: row.reviewStatus,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })),
    total,
    page: input.page,
    limit: input.limit
  };
};
export const publicDetail = async (id, actorId = null) => {
  const listing = await repository.publishedDetail(id);
  if (!listing)
    throw new HttpError(
      404,
      "LISTING_NOT_FOUND",
      "Published listing was not found."
    );
  const [
    media,
    amenities,
    promotions,
    favorite,
    parcelSummary,
    verification,
    landPassport,
    scanner
  ] = await Promise.all([
    repository.media(listing.propertyId),
    repository.amenities(listing.propertyId),
    repository.promotions(id),
    actorId
      ? repository.isFavorite(id, actorId)
      : Promise.resolve({ isFavorite: false }),
    repository.parcelSummary(listing.propertyId),
    verificationSummary(listing.propertyId),
    propertyPassport(listing.propertyId),
    propertyScanner(listing.propertyId)
  ]);
  return {
    listing: {
      id: listing.listingId,
      listingCode: listing.listingCode,
      propertyId: listing.propertyId,
      transactionType: listing.transactionType,
      title: listing.title,
      description: listing.description,
      priceAmountMinor: listing.priceAmountMinor,
      currency: listing.currency,
      isNegotiable: listing.isNegotiable,
      reviewStatus: listing.reviewStatus,
      status: listing.listingStatus,
      publishedAt: listing.publishedAt,
      expiresAt: listing.expiresAt
    },
    property: {
      id: listing.propertyId,
      publicCode: listing.propertyCode,
      source: listing.propertySource,
      status: listing.propertyStatus,
      propertyType: {
        id: listing.propertyTypeId,
        code: listing.propertyTypeCode,
        name: listing.propertyType
      },
      landUseType: listing.landUseTypeId
        ? {
            id: listing.landUseTypeId,
            code: listing.landUseTypeCode,
            name: listing.landUseType
          }
        : null,
      ownershipType: listing.ownershipTypeId
        ? {
            id: listing.ownershipTypeId,
            code: listing.ownershipTypeCode,
            name: listing.ownershipType
          }
        : null,
      completionPercent: scanner.readinessScore
    },
    landDetails: {
      areaValue: listing.areaValue,
      areaUnitId: listing.areaUnitId,
      areaUnitCode: listing.areaUnitCode,
      normalizedAreaSqft: listing.areaSqft,
      lengthValue: listing.lengthValue,
      widthValue: listing.widthValue,
      dimensionUnitId: listing.dimensionUnitId,
      dimensionUnitCode: listing.dimensionUnitCode,
      frontageM: listing.frontageM,
      roadWidthM: listing.roadWidthM,
      roadTypeId: listing.roadTypeId,
      roadTypeCode: listing.roadTypeCode,
      facing: listing.facing,
      openSides: listing.openSides,
      isCornerPlot: listing.isCornerPlot,
      hasBoundaryWall: listing.hasBoundaryWall,
      terrain: listing.terrain,
      roadAccessType: listing.roadAccessType
    },
    location: listing.locationId
      ? {
          locationId: listing.locationId,
          location: {
            id: listing.locationId,
            name: listing.locationName,
            type: listing.locationType,
            parentId: listing.locationParentId,
            stateCode: listing.locationStateCode
          },
          pincode: listing.pincode,
          addressLine: listing.addressLine,
          landmark: listing.landmark,
          formattedAddress: listing.formattedAddress,
          latitude: listing.latitude,
          longitude: listing.longitude,
          locationPrecision: listing.locationPrecision,
          showExactLocation: listing.showExactLocation
        }
      : null,
    media: await Promise.all(
      media.map(async item => ({
        ...item,
        url: await signedReadUrl(item.storageKey),
        thumbnailUrl: await signedReadUrl(item.thumbnailStorageKey)
      }))
    ),
    amenities,
    parcelSummary,
    seller: {
      id: listing.sellerId,
      displayName: listing.sellerDisplayName,
      organization: listing.organizationId
        ? {
            id: listing.organizationId,
            name: listing.organizationName,
            type: listing.organizationType
          }
        : null
    },
    verification,
    landPassport,
    scanner,
    promotions: promotions.map(item => item.promotionType),
    isFavorite: favorite.isFavorite
  };
};
export const adminListings = async input => {
  const rows = await repository.adminListings({
    ...input,
    offset: (input.page - 1) * input.limit
  });
  const cards = await listingCardsByIds(
    rows.map(row => row.id),
    null,
    true
  );
  const cardsById = new Map(cards.map(card => [card.listingId, card]));
  return {
    items: rows.map(({ total: ignored, ...row }) => ({
      ...cardsById.get(row.id),
      reviewStatus: row.reviewStatus,
      status: row.status,
      submittedAt: row.submittedAt,
      createdAt: row.createdAt
    })),
    total: rows[0]?.total || 0,
    page: input.page,
    limit: input.limit
  };
};
export const adminListing = async id => {
  const listing = await repository.adminListing(id);
  if (!listing)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  return listing;
};
export const approve = async ({ id, approval, actorId }) => {
  const before = await repository.summary(id);
  const result = await repository.approve({
    id,
    expiresAt: approval.expiresAt
  });
  if (!result)
    throw new HttpError(
      404,
      "LISTING_NOT_FOUND",
      "Pending listing was not found."
    );
  const listing = await repository.summary(result.id);
  await repository.audit({
    actorId,
    action: "LISTING_APPROVED",
    listingId: result.id,
    before,
    after: listing,
    note: approval.note
  });
  return approval.note ? { ...listing, approvalNote: approval.note } : listing;
};
export const reject = async ({ id, reason, actorId }) => {
  const before = await repository.summary(id);
  const result = await repository.reject(id, reason);
  if (!result)
    throw new HttpError(
      404,
      "LISTING_NOT_FOUND",
      "Pending listing was not found."
    );
  const listing = await repository.summary(result.id);
  await repository.audit({
    actorId,
    action: "LISTING_REJECTED",
    listingId: result.id,
    before,
    after: listing,
    note: reason
  });
  return listing;
};
export const suspend = async ({ id, reason, actorId }) => {
  const before = await repository.summary(id);
  const result = await repository.suspend(id);
  if (!result)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  const listing = await repository.summary(result.id);
  await repository.audit({
    actorId,
    action: "LISTING_SUSPENDED",
    listingId: result.id,
    before,
    after: listing,
    note: reason
  });
  return listing;
};

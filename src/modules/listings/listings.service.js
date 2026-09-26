import { randomUUID } from "node:crypto";
import { HttpError } from "../../shared/http.js";
import { listingCardsByIds } from "../../shared/listingCard.js";
import logger from "../../utils/logger.js";
import { signedReadUrl } from "../../utils/storage.js";
import { grantFeaturedListing, resolveListingLimit } from "../commerce/entitlements.service.js";
import * as notifications from "../notifications/notifications.service.js";
import {
  deleteMedia as deletePropertyMedia,
  getLocation as propertyLocation,
  listDocuments as propertyDocuments,
  ownedProperty,
  passport as propertyPassport,
  scanner as propertyScanner,
  verificationSummary
} from "../properties/properties.service.js";
import * as repository from "./listings.repository.js";

// Applied when an admin approves a listing without an explicit expiresAt —
// the documented AdminApproveListing contract says "otherwise backend
// plan/default decides" (docs/Zameen_API_PLAN_FULL.md), but no default ever
// existed, so an approval that omitted expiresAt (a fully optional field)
// left the listing PUBLISHED forever, immune to the expiry sweep
// (repository.expirePublished only touches rows with expires_at set).
const DEFAULT_LISTING_DURATION_DAYS = 90;
const defaultListingExpiry = () =>
  new Date(Date.now() + DEFAULT_LISTING_DURATION_DAYS * 24 * 60 * 60 * 1000);

const listingCode = () =>
  `ZMN-L-${randomUUID()
    .replace(/-/g, "")
    .slice(0, 12)
    .toUpperCase()}`;
const signMedia = mediaRows =>
  Promise.all(
    mediaRows.map(async item => ({
      ...item,
      url: await signedReadUrl(item.storageKey),
      thumbnailUrl: await signedReadUrl(item.thumbnailStorageKey)
    }))
  );
const mediaWithUrls = async propertyId =>
  signMedia(await repository.media(propertyId));
const listingPropertyContext = async propertyId => {
  const [media, documents, location] = await Promise.all([
    mediaWithUrls(propertyId),
    propertyDocuments(propertyId),
    propertyLocation(propertyId)
  ]);
  const { propertyId: ignored, ...locationDetails } = location || {};
  return { media, documents, location: location ? locationDetails : null };
};
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
export const summary = async id => {
  const listing = await repository.summary(id);
  if (!listing) return listing;
  return {
    ...listing,
    ...(await listingPropertyContext(listing.propertyId))
  };
};
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
  if (
    !["DRAFT", "REJECTED"].includes(listing.review_status) ||
    listing.status !== "INACTIVE"
  )
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Listing cannot be submitted from its current state."
    );
  const owner = { userId: listing.seller_user_id, organizationId: listing.seller_organization_id };
  // Resolved here (read-only, matching the original check's timing/ordering
  // relative to the readiness check below) but only enforced later, inside
  // submitWithinLimit's locked transaction — see resolveListingLimit's own
  // comment for why a plain check-then-write would race.
  const limit = await resolveListingLimit(owner);
  const scanner = await propertyScanner(listing.property_id);
  if (scanner.readinessScore < 100)
    throw new HttpError(
      409,
      "LISTING_NOT_READY",
      "Complete the required land, location, parcel, document, and media details before submitting this listing.",
      scanner.missingItems
    );
  let result;
  try {
    result = await repository.submitWithinLimit({ id: listing.id, ...owner, limit });
  } catch (error) {
    if (error?.code === "23505")
      throw new HttpError(
        409,
        "LIVE_LISTING_EXISTS",
        "This property already has a live listing."
      );
    throw error;
  }
  if (result.reason === "LIMIT_REACHED")
    throw new HttpError(403, "PLAN_LIMIT_REACHED", `This plan allows up to ${limit} active listings.`, {
      feature: "ACTIVE_LISTINGS",
      used: result.used,
      limit,
      upgradeRequired: true
    });
  if (!result.submitted)
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
    valid: ["PAUSED"],
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
// Draws one unit from the listing owner's plan-included monthly featured
// allowance (commerce.plans.features.featuredListingsPerMonth), if any is
// left, and grants the FEATURED promotion directly — bypassing checkout.
// When there is no allowance (no active plan, or this month's is used up),
// the caller falls back to the existing paid-promotion flow
// (POST /orders with a PROMOTION product) instead.
export const feature = async listing => {
  const { promotion, alreadyFeatured } = await grantFeaturedListing(
    { userId: listing.seller_user_id, organizationId: listing.seller_organization_id },
    listing.id
  );
  if (alreadyFeatured)
    throw new HttpError(
      409,
      "LISTING_ALREADY_FEATURED",
      "This listing is already featured."
    );
  if (!promotion)
    throw new HttpError(
      403,
      "PLAN_LIMIT_REACHED",
      "No plan-included featured listings remain this month. Purchase a featured promotion instead.",
      { feature: "FEATURED_LISTINGS", upgradeRequired: true, checkoutRequired: true }
    );
  return { listingId: listing.id, promotionType: "FEATURED", endsAt: promotion.endsAt };
};

export const sellerListings = async input => {
  const rows = await repository.sellerListings(input);
  const total = rows[0]?.total || 0;
  const cards = await listingCardsByIds(
    rows.map(row => row.id),
    input.userId,
    { requirePublished: false }
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
// Shared by publicDetail (buyer-facing, PUBLISHED-only) and adminListing
// (any status, moderation-only fields included). Admin-only source columns
// (rejectionReason, submittedAt, approvedAt, soldAt, createdAt, updatedAt,
// sellerPhoneE164, sellerEmail) are simply absent on the public row, so they
// come through here as undefined and JSON.stringify drops them from the
// response — the public payload never has to filter them back out.
const buildListingDetail = async (
  listing,
  { media, amenities, parcelSummary, verification, landPassport, scanner, promotions }
) => ({
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
    rejectionReason: listing.rejectionReason,
    submittedAt: listing.submittedAt,
    approvedAt: listing.approvedAt,
    publishedAt: listing.publishedAt,
    expiresAt: listing.expiresAt,
    soldAt: listing.soldAt,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt
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
    dimensionUnit: listing.dimensionUnit,
    frontageM: listing.frontageM,
    roadWidthM: listing.roadWidthM,
    roadType: listing.roadType,
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
  media: await signMedia(media),
  amenities,
  parcelSummary,
  seller: {
    id: listing.sellerId,
    displayName: listing.sellerDisplayName,
    phoneE164: listing.sellerPhoneE164,
    email: listing.sellerEmail,
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
  promotions: promotions.map(item => item.promotionType)
});
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
    ...(await buildListingDetail(listing, {
      media,
      amenities,
      parcelSummary,
      verification,
      landPassport,
      scanner,
      promotions
    })),
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
    { requirePublished: false }
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
  const listing = await repository.adminDetail(id);
  if (!listing)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  const [
    media,
    amenities,
    promotions,
    parcelSummary,
    verification,
    landPassport,
    scanner
  ] = await Promise.all([
    repository.media(listing.propertyId),
    repository.amenities(listing.propertyId),
    repository.promotions(id),
    repository.parcelSummary(listing.propertyId),
    verificationSummary(listing.propertyId),
    propertyPassport(listing.propertyId),
    propertyScanner(listing.propertyId)
  ]);
  return buildListingDetail(listing, {
    media,
    amenities,
    parcelSummary,
    verification,
    landPassport,
    scanner,
    promotions
  });
};
export const approve = async ({ id, approval, actorId }) => {
  const before = await repository.summary(id);
  if (!before)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Pending listing was not found.");
  // Preserve an existing expiry if the listing already had one (e.g. a
  // second approval cycle), otherwise fall back to the 90-day default — the
  // repository's own COALESCE(new, existing) only covers the first of
  // those two cases, never actually setting a value the very first time.
  const expiresAt = approval.expiresAt || before?.expiresAt || defaultListingExpiry();
  // The listing could be withdrawn/deleted by its seller (a PENDING listing
  // stays status = 'INACTIVE', so remove()'s PUBLISHED-only guard doesn't
  // block that) in the gap between the summary() read above and this one —
  // ownerFields filters deleted_at IS NULL, so it returns null in that case.
  const owner = await repository.ownerFields(id);
  if (!owner)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Pending listing was not found.");
  const ownerScope = { userId: owner.sellerUserId, organizationId: owner.sellerOrganizationId };
  const limit = await resolveListingLimit(ownerScope);
  const result = await repository.approveWithinLimit({
    id,
    ...ownerScope,
    limit,
    expiresAt
  });
  if (result.reason === "LIMIT_REACHED")
    throw new HttpError(403, "PLAN_LIMIT_REACHED", `This plan allows up to ${limit} active listings.`, {
      feature: "ACTIVE_LISTINGS",
      used: result.used,
      limit,
      upgradeRequired: true
    });
  if (!result.approved)
    throw new HttpError(
      404,
      "LISTING_NOT_FOUND",
      "Pending listing was not found."
    );
  const listing = await repository.summary(result.approved.id);
  await repository.audit({
    actorId,
    action: "LISTING_APPROVED",
    listingId: result.approved.id,
    before,
    after: listing,
    note: approval.note
  });
  await notifications.notifySeller(result.approved.id, {
    type: "LISTING_APPROVED",
    title: "Your listing was approved",
    body: "Your listing is now live and visible to buyers.",
    data: { listingId: result.approved.id }
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
  await notifications.notifySeller(result.id, {
    type: "LISTING_REJECTED",
    title: "Your listing was rejected",
    body: reason || "Your listing was rejected during review.",
    data: { listingId: result.id, reason }
  });
  return listing;
};
export const suspend = async ({ id, reason, actorId }) => {
  const before = await repository.summary(id);
  if (!before)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  const result = await repository.suspend(id);
  if (!result)
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Listing cannot be suspended from its current state."
    );
  const listing = await repository.summary(result.id);
  await repository.audit({
    actorId,
    action: "LISTING_SUSPENDED",
    listingId: result.id,
    before,
    after: listing,
    note: reason
  });
  await notifications.notifySeller(result.id, {
    type: "LISTING_SUSPENDED",
    title: "Your listing was suspended",
    body: reason || "Your listing was suspended by an administrator.",
    data: { listingId: result.id, reason }
  });
  return listing;
};
export const reinstate = async ({ id, reason, actorId }) => {
  const before = await repository.summary(id);
  if (!before)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  const result = await repository.reinstate(id);
  if (!result)
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Listing cannot be reinstated from its current state."
    );
  const listing = await repository.summary(result.id);
  await repository.audit({
    actorId,
    action: "LISTING_REINSTATED",
    listingId: result.id,
    before,
    after: listing,
    note: reason
  });
  await notifications.notifySeller(result.id, {
    type: "LISTING_REINSTATED",
    title: "Your listing was reinstated",
    body: "Your listing is active again.",
    data: { listingId: result.id }
  });
  return listing;
};
export const removeMedia = async ({ listingId, mediaId, reason, actorId }) => {
  const before = await repository.summary(listingId);
  if (!before)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  await deletePropertyMedia({ propertyId: before.propertyId, mediaId });
  await repository.audit({
    actorId,
    action: "LISTING_MEDIA_REMOVED",
    listingId,
    before,
    after: { ...before, removedMediaId: mediaId },
    note: reason
  });
  await notifications.notifySeller(listingId, {
    type: "LISTING_MEDIA_REMOVED",
    title: "A photo was removed from your listing",
    body:
      reason ||
      "One of your listing photos was removed by an administrator for not meeting our content guidelines.",
    data: { listingId, mediaId, reason }
  });
  return adminListing(listingId);
};
export const expirePublishedListings = async () => {
  const expired = await repository.expirePublished();
  if (expired.length)
    logger.info(
      `Expired ${expired.length} published listing(s) past their expiresAt.`
    );
  return expired.length;
};

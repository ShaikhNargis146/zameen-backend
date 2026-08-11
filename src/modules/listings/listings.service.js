import { randomUUID } from "crypto";
import { HttpError } from "../../shared/http.js";
import { ownedProperty } from "../properties/properties.service.js";
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
  const saved = await repository.create({
    ...input,
    propertyId: property.id,
    userId: actorId,
    listingCode: listingCode()
  });
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
  return repository.summary(listing.id);
};
export const remove = async listing => {
  if (listing.status === "PUBLISHED")
    throw new HttpError(
      409,
      "WITHDRAW_LISTING_FIRST",
      "Published listings must be withdrawn before deletion."
    );
  await repository.archive(listing.id);
};
export const submit = async listing => {
  if (!["DRAFT", "REJECTED"].includes(listing.review_status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      "Listing cannot be submitted from its current state."
    );
  await repository.submit(listing.id);
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
export const transition = async (listing, action) => {
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
  await repository.transition({
    id: listing.id,
    status: rule.status,
    setPublishedAt: rule.published,
    setSoldAt: rule.sold
  });
  return repository.summary(listing.id);
};
export const sellerListings = repository.sellerListings;
export const publicDetail = async id => {
  const listing = await repository.publishedDetail(id);
  if (!listing)
    throw new HttpError(
      404,
      "LISTING_NOT_FOUND",
      "Published listing was not found."
    );
  const [media, amenities, promotions] = await Promise.all([
    repository.media(listing.propertyId),
    repository.amenities(listing.propertyId),
    repository.promotions(id)
  ]);
  return {
    listing,
    media,
    amenities,
    promotions: promotions.map(item => item.promotionType)
  };
};
export const adminListings = repository.adminListings;
export const approve = async id => {
  const result = await repository.approve(id);
  if (!result)
    throw new HttpError(
      404,
      "LISTING_NOT_FOUND",
      "Pending listing was not found."
    );
  return repository.summary(result.id);
};
export const reject = async (id, reason) => {
  const result = await repository.reject(id, reason);
  if (!result)
    throw new HttpError(
      404,
      "LISTING_NOT_FOUND",
      "Pending listing was not found."
    );
  return repository.summary(result.id);
};
export const suspend = async id => {
  const result = await repository.suspend(id);
  if (!result)
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing was not found.");
  return repository.summary(result.id);
};

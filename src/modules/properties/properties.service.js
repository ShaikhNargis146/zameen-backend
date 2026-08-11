import { randomUUID } from "crypto";
import { HttpError } from "../../shared/http.js";
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
    items: await Promise.all(ids.map(row => repository.summary(row.id))),
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

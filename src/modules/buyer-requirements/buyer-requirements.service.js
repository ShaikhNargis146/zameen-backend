import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta } from "../../shared/pagination.js";
import * as repository from "./buyer-requirements.repository.js";
import { uuid } from "./buyer-requirements.validation.js";

const mapDbError = error => {
  if (error?.code === "23503")
    return new HttpError(
      400,
      "INVALID_REFERENCE",
      "locationId or propertyTypeId does not reference an existing record."
    );
  if (error?.code === "23514")
    return new HttpError(
      400,
      "INVALID_RANGE",
      "maxArea/maxBudgetMinor must be greater than or equal to the minimum."
    );
  return error;
};

const normalizeArea = async ({ minArea, maxArea, areaUnitId }) => {
  if (minArea === null && maxArea === null)
    return { minAreaSqft: null, maxAreaSqft: null };
  if (!areaUnitId)
    throw new HttpError(
      400,
      "AREA_UNIT_REQUIRED",
      "areaUnitId is required when minArea or maxArea is supplied."
    );
  const areaUnit = await repository.findAreaUnit(areaUnitId);
  if (!areaUnit)
    throw new HttpError(
      400,
      "INVALID_AREA_UNIT",
      "areaUnitId does not reference a valid area unit."
    );
  const multiplier = Number(areaUnit.sqftMultiplier);
  return {
    minAreaSqft: minArea === null ? null : minArea * multiplier,
    maxAreaSqft: maxArea === null ? null : maxArea * multiplier
  };
};

const toBuyerRequirement = row => {
  const extra = row.extraFilters || {};
  return {
    id: row.id,
    name: row.name,
    locationId: row.locationId,
    propertyTypeId: row.propertyTypeId,
    minArea: extra.minArea ?? null,
    maxArea: extra.maxArea ?? null,
    areaUnitId: extra.areaUnitId ?? null,
    minBudgetMinor: row.minBudgetMinor === null ? null : Number(row.minBudgetMinor),
    maxBudgetMinor: row.maxBudgetMinor === null ? null : Number(row.maxBudgetMinor),
    purpose: row.purpose,
    roadWidthMinM: extra.roadWidthMinM ?? null,
    verifiedOnly: extra.verifiedOnly ?? false,
    status: row.status,
    normalizedMinAreaSqft:
      row.normalizedMinAreaSqft === null ? null : Number(row.normalizedMinAreaSqft),
    normalizedMaxAreaSqft:
      row.normalizedMaxAreaSqft === null ? null : Number(row.normalizedMaxAreaSqft),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
};

export const ownedRequirement = async (requirementId, actorId) => {
  const requirement = await repository.findOwned(
    uuid(requirementId, "requirementId"),
    actorId
  );
  if (!requirement)
    throw new HttpError(
      404,
      "BUYER_REQUIREMENT_NOT_FOUND",
      "Buyer requirement was not found."
    );
  return requirement;
};

export const create = async ({ actorId, input }) => {
  const { minAreaSqft, maxAreaSqft } = await normalizeArea(input);
  const result = await repository.insert({
    userId: actorId,
    name: input.name,
    locationId: input.locationId,
    propertyTypeId: input.propertyTypeId,
    minAreaSqft,
    maxAreaSqft,
    minBudgetMinor: input.minBudgetMinor,
    maxBudgetMinor: input.maxBudgetMinor,
    purpose: input.purpose,
    status: input.status || "ACTIVE",
    extraFilters: {
      minArea: input.minArea,
      maxArea: input.maxArea,
      areaUnitId: input.areaUnitId,
      roadWidthMinM: input.roadWidthMinM,
      verifiedOnly: input.verifiedOnly
    }
  });
  if (!result.ok) throw mapDbError(result.error);
  return toBuyerRequirement(result.data);
};

export const get = requirement => toBuyerRequirement(requirement);

export const list = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const [rows, { count }] = await Promise.all([
    repository.listForUser(actorId, filters, { limit, offset }),
    repository.countForUser(actorId, filters)
  ]);
  return {
    data: rows.map(toBuyerRequirement),
    meta: paginationMeta({ page, limit, total: count })
  };
};

export const update = async ({ requirement, changes }) => {
  const extra = requirement.extraFilters || {};
  const areaTouched = ["minArea", "maxArea", "areaUnitId"].some(key =>
    Object.hasOwn(changes, key)
  );
  const effectiveArea = {
    minArea: Object.hasOwn(changes, "minArea") ? changes.minArea : extra.minArea ?? null,
    maxArea: Object.hasOwn(changes, "maxArea") ? changes.maxArea : extra.maxArea ?? null,
    areaUnitId: Object.hasOwn(changes, "areaUnitId")
      ? changes.areaUnitId
      : extra.areaUnitId ?? null
  };

  const set = {};
  if (Object.hasOwn(changes, "name")) set.name = changes.name;
  if (Object.hasOwn(changes, "locationId")) set.location_id = changes.locationId;
  if (Object.hasOwn(changes, "propertyTypeId")) set.property_type_id = changes.propertyTypeId;
  if (Object.hasOwn(changes, "minBudgetMinor")) set.min_budget_minor = changes.minBudgetMinor;
  if (Object.hasOwn(changes, "maxBudgetMinor")) set.max_budget_minor = changes.maxBudgetMinor;
  if (Object.hasOwn(changes, "purpose")) set.purpose = changes.purpose;
  if (Object.hasOwn(changes, "status")) set.status = changes.status;

  if (areaTouched) {
    const { minAreaSqft, maxAreaSqft } = await normalizeArea(effectiveArea);
    set.min_area_sqft = minAreaSqft;
    set.max_area_sqft = maxAreaSqft;
  }

  set.extra_filters = {
    minArea: effectiveArea.minArea,
    maxArea: effectiveArea.maxArea,
    areaUnitId: effectiveArea.areaUnitId,
    roadWidthMinM: Object.hasOwn(changes, "roadWidthMinM")
      ? changes.roadWidthMinM
      : extra.roadWidthMinM ?? null,
    verifiedOnly: Object.hasOwn(changes, "verifiedOnly")
      ? changes.verifiedOnly
      : extra.verifiedOnly ?? false
  };

  const result = await repository.update(requirement.id, set);
  if (!result.ok) throw mapDbError(result.error);
  return toBuyerRequirement(result.data);
};

export const remove = requirement => repository.remove(requirement.id);

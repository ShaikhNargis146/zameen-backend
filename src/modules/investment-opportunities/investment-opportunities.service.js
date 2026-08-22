import { HttpError } from "../../shared/http.js";
import { paginationMeta, parsePagination } from "../../shared/pagination.js";
import * as repository from "./investment-opportunities.repository.js";

const toLocationSummary = row =>
  row.locationId
    ? {
        id: row.locationId,
        name: row.locationName,
        type: row.locationType,
        parentId: row.locationParentId,
        stateCode: row.locationStateCode,
        latitude: row.locationLatitude === null ? null : Number(row.locationLatitude),
        longitude: row.locationLongitude === null ? null : Number(row.locationLongitude),
        displayPath: row.locationDisplayPath
      }
    : null;

const toOpportunity = row => ({
  id: row.id,
  title: row.title,
  location: toLocationSummary(row),
  propertyId: row.propertyId,
  investmentType: row.investmentType,
  minimumInvestmentMinor: row.minimumInvestmentMinor === null ? null : Number(row.minimumInvestmentMinor),
  description: row.description,
  status: row.status,
  publishedAt: row.publishedAt
});

export const list = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const rows = await repository.list({ ...filters, limit, offset });
  const total = rows[0]?.total || 0;
  return { data: rows.map(toOpportunity), meta: paginationMeta({ page, limit, total }) };
};

const notFound = () =>
  new HttpError(404, "OPPORTUNITY_NOT_FOUND", "Investment opportunity was not found.");

export const detail = async ({ id, isAdmin }) => {
  const row = await repository.findById(id);
  if (!row || (!isAdmin && row.status !== "PUBLISHED")) throw notFound();
  return toOpportunity(row);
};

const mapReferenceError = error => {
  if (error?.code === "23503")
    throw new HttpError(400, "INVALID_REFERENCE", "locationId or propertyId does not exist.");
  throw error;
};

export const create = async ({ actorId, input }) => {
  let id;
  try {
    const inserted = await repository.create({ ...input, createdByUserId: actorId });
    id = inserted.id;
  } catch (error) {
    mapReferenceError(error);
  }
  return toOpportunity(await repository.findById(id));
};

export const update = async ({ id, changes }) => {
  const existing = await repository.findById(id);
  if (!existing) throw notFound();
  try {
    const result = await repository.update(id, changes);
    if (!result.ok) throw result.error;
  } catch (error) {
    mapReferenceError(error);
  }
  return toOpportunity(await repository.findById(id));
};

const transitions = {
  publish: { valid: ["DRAFT"], status: "PUBLISHED", label: "published" },
  close: { valid: ["DRAFT", "PUBLISHED"], status: "CLOSED", label: "closed" }
};

export const transition = async ({ id, action, actorId, note }) => {
  const rule = transitions[action];
  const before = await repository.findById(id);
  if (!before) throw notFound();
  if (!rule.valid.includes(before.status))
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      `Investment opportunity cannot be ${rule.label} from its current state.`
    );
  const updated = await repository.setStatus({
    id,
    status: rule.status,
    validStatuses: rule.valid,
    setPublishedAt: action === "publish"
  });
  if (!updated)
    throw new HttpError(
      409,
      "OPPORTUNITY_TRANSITION_CONFLICT",
      "Investment opportunity changed before this transition could be applied."
    );
  const after = await repository.findById(id);
  await repository.audit({
    actorId,
    action: `INVESTMENT_OPPORTUNITY_${rule.label.toUpperCase()}`,
    opportunityId: id,
    before,
    after,
    note
  });
  return toOpportunity(after);
};

export const createInterest = async ({ opportunityId, actorId, input }) => {
  const opportunity = await repository.findById(opportunityId);
  if (!opportunity || opportunity.status !== "PUBLISHED") throw notFound();
  try {
    const row = await repository.createInterest({ opportunityId, userId: actorId, ...input });
    return { id: row.id, opportunityId: row.opportunityId, status: row.status, createdAt: row.createdAt };
  } catch (error) {
    if (error?.code === "23503")
      throw new HttpError(400, "INVALID_REFERENCE", "organizationId does not exist.");
    throw error;
  }
};

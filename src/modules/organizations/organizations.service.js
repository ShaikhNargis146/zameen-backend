import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import * as repository from "./organizations.repository.js";

const notFound = () =>
  new HttpError(404, "ORGANIZATION_NOT_FOUND", "Organization was not found.");

const requireOrganization = async organizationId => {
  const organization = await repository.findById(organizationId);
  if (!organization) throw notFound();
  return organization;
};

const requireMembership = async (organizationId, userId) => {
  const membership = await repository.findMembership(organizationId, userId);
  if (!membership || membership.status !== "ACTIVE")
    throw new HttpError(
      403,
      "ORGANIZATION_MEMBERSHIP_REQUIRED",
      "You are not a member of this organization."
    );
  return membership;
};

const requireManager = async (organizationId, userId) => {
  const membership = await requireMembership(organizationId, userId);
  if (!["OWNER", "ADMIN"].includes(membership.role))
    throw new HttpError(
      403,
      "ORGANIZATION_ROLE_REQUIRED",
      "Organization owner or admin access is required."
    );
  return membership;
};

export const create = ({ actorId, input }) =>
  repository.createWithOwner({ ...input, createdByUserId: actorId });

export const listMine = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForUser(actorId, filters, { limit, offset });
  const { data, total } = splitCountedRows(counted);
  return { data, meta: paginationMeta({ page, limit, total }) };
};

export const get = async ({ organizationId, actorId }) => {
  const organization = await repository.findById(organizationId);
  if (!organization) throw notFound();
  if (organization.status === "ACTIVE") return organization;
  const membership = actorId
    ? await repository.findMembership(organizationId, actorId)
    : null;
  if (!membership || membership.status !== "ACTIVE") throw notFound();
  return organization;
};

export const update = async ({ organizationId, actorId, changes }) => {
  await requireOrganization(organizationId);
  await requireManager(organizationId, actorId);
  const result = await repository.update(organizationId, changes);
  if (!result.ok) {
    if (result.error?.received === 0) throw notFound();
    throw result.error;
  }
  return result.data;
};

export const changeStatus = async ({ actorId, organizationId, status, request }) => {
  const before = await requireOrganization(organizationId);
  const after = await repository.setStatus(organizationId, status);
  if (!after) throw notFound();
  await repository.audit({
    actorId,
    action: "ORGANIZATION_STATUS_CHANGED",
    entityId: organizationId,
    before,
    after,
    ...request
  });
  return after;
};

export const listMembers = async ({ organizationId, actorId }) => {
  await requireOrganization(organizationId);
  await requireMembership(organizationId, actorId);
  const rows = await repository.listMembers(organizationId);
  return rows.map(({ id, name, phone, email, role, status, joinedAt }) => ({
    user: { id, name, phone, email },
    role,
    status,
    joinedAt
  }));
};

export const addMember = async ({ organizationId, actorId, userId, role }) => {
  await requireOrganization(organizationId);
  await requireManager(organizationId, actorId);
  const user = await repository.findUserSummary(userId);
  if (!user)
    throw new HttpError(
      400,
      "USER_NOT_FOUND",
      "userId must reference an existing user."
    );
  const membership = await repository.addMember(organizationId, userId, role);
  return {
    user,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt
  };
};

export const removeMember = async ({ organizationId, actorId, userId }) => {
  await requireOrganization(organizationId);
  await requireManager(organizationId, actorId);
  const target = await repository.findMembership(organizationId, userId);
  if (!target || target.status === "REMOVED")
    throw new HttpError(
      404,
      "MEMBER_NOT_FOUND",
      "Organization member was not found."
    );
  if (target.role === "OWNER") {
    const { count } = await repository.countActiveOwners(organizationId);
    if (count <= 1)
      throw new HttpError(
        400,
        "LAST_OWNER",
        "The organization must retain at least one owner."
      );
  }
  await repository.removeMember(organizationId, userId);
};

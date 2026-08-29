import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import { signedReadUrl } from "../../utils/storage.js";
import * as repository from "./organizations.repository.js";

const notFound = () =>
  new HttpError(404, "ORGANIZATION_NOT_FOUND", "Organization was not found.");

const withLogoUrl = async organization => {
  if (!organization) return organization;
  const { logoStorageKey, ...rest } = organization;
  return { ...rest, logoUrl: await signedReadUrl(logoStorageKey) };
};

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

export const create = async ({ actorId, input }) =>
  withLogoUrl(
    await repository.createWithOwner({ ...input, createdByUserId: actorId })
  );

export const listMine = async ({ actorId, filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listForUser(actorId, filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  const data = await Promise.all(rows.map(withLogoUrl));
  return { data, meta: paginationMeta({ page, limit, total }) };
};

export const get = async ({ organizationId, actorId }) => {
  const organization = await repository.findById(organizationId);
  if (!organization) throw notFound();
  if (organization.status === "ACTIVE") return withLogoUrl(organization);
  const membership = actorId
    ? await repository.findMembership(organizationId, actorId)
    : null;
  if (!membership || membership.status !== "ACTIVE") throw notFound();
  return withLogoUrl(organization);
};

export const update = async ({ organizationId, actorId, changes }) => {
  await requireOrganization(organizationId);
  await requireManager(organizationId, actorId);
  const result = await repository.update(organizationId, changes);
  if (!result.ok) {
    if (result.error?.received === 0) throw notFound();
    throw result.error;
  }
  return withLogoUrl(result.data);
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
  return withLogoUrl(after);
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
  const actorMembership = await requireManager(organizationId, actorId);
  const existing = await repository.findMembership(organizationId, userId);
  const changesOwnership = role === "OWNER" || existing?.role === "OWNER";
  if (changesOwnership && actorMembership.role !== "OWNER")
    throw new HttpError(
      403,
      "OWNER_ROLE_REQUIRED",
      "Only an existing owner can grant or change owner access."
    );
  if (existing?.role === "OWNER" && existing.status === "ACTIVE" && role !== "OWNER") {
    const { count } = await repository.countActiveOwners(organizationId);
    if (count <= 1)
      throw new HttpError(
        400,
        "LAST_OWNER",
        "The organization must retain at least one owner."
      );
  }
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
  const actorMembership = await requireManager(organizationId, actorId);
  const target = await repository.findMembership(organizationId, userId);
  if (!target || target.status === "REMOVED")
    throw new HttpError(
      404,
      "MEMBER_NOT_FOUND",
      "Organization member was not found."
    );
  if (target.role === "OWNER") {
    if (actorMembership.role !== "OWNER")
      throw new HttpError(
        403,
        "OWNER_ROLE_REQUIRED",
        "Only an existing owner can remove an owner."
      );
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

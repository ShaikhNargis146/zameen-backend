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

// A suspended organization is not just hidden from outside viewers — its
// own OWNER/ADMIN must not be able to keep editing details or managing
// membership while it's suspended. Only the admin-only status endpoint can
// change status itself, so that path never calls this.
const requireActiveOrganization = organization => {
  if (organization.status === "SUSPENDED")
    throw new HttpError(
      403,
      "ORGANIZATION_SUSPENDED",
      "This organization is suspended and cannot be modified."
    );
  return organization;
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
  requireActiveOrganization(await requireOrganization(organizationId));
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
  requireActiveOrganization(await requireOrganization(organizationId));
  const actorMembership = await requireManager(organizationId, actorId);
  const existing = await repository.findMembership(organizationId, userId);
  const changesOwnership = role === "OWNER" || existing?.role === "OWNER";
  if (changesOwnership && actorMembership.role !== "OWNER")
    throw new HttpError(
      403,
      "OWNER_ROLE_REQUIRED",
      "Only an existing owner can grant or change owner access."
    );
  const user = await repository.findUserSummary(userId);
  if (!user)
    throw new HttpError(
      400,
      "USER_NOT_FOUND",
      "userId must reference an existing user."
    );
  // The last-owner guard is enforced atomically inside repository.addMember
  // itself (under an advisory lock), not here — a separate check-then-write
  // in this service function would leave the same TOCTOU race it's meant
  // to close.
  const { membership, reason } = await repository.addMember(organizationId, userId, role);
  if (reason === "LAST_OWNER")
    throw new HttpError(
      400,
      "LAST_OWNER",
      "The organization must retain at least one owner."
    );
  return {
    user,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt
  };
};

// The invited user accepting their own pending invite — the only path that
// ever moves a membership from INVITED to ACTIVE.
export const acceptMembership = async ({ organizationId, actorId }) => {
  await requireOrganization(organizationId);
  const membership = await repository.acceptInvite(organizationId, actorId);
  if (!membership)
    throw new HttpError(
      404,
      "INVITE_NOT_FOUND",
      "No pending invitation was found for you in this organization."
    );
  return membership;
};

export const removeMember = async ({ organizationId, actorId, userId }) => {
  requireActiveOrganization(await requireOrganization(organizationId));
  const actorMembership = await requireManager(organizationId, actorId);
  const preCheck = await repository.findMembership(organizationId, userId);
  if (!preCheck || preCheck.status === "REMOVED")
    throw new HttpError(
      404,
      "MEMBER_NOT_FOUND",
      "Organization member was not found."
    );
  if (preCheck.role === "OWNER" && actorMembership.role !== "OWNER")
    throw new HttpError(
      403,
      "OWNER_ROLE_REQUIRED",
      "Only an existing owner can remove an owner."
    );
  // As with addMember, the authoritative last-owner guard runs atomically
  // inside repository.removeMember — this pre-check is only for a fast,
  // friendly error in the common (non-racing) case.
  const { reason } = await repository.removeMember(organizationId, userId);
  if (reason === "NOT_FOUND")
    throw new HttpError(
      404,
      "MEMBER_NOT_FOUND",
      "Organization member was not found."
    );
  if (reason === "LAST_OWNER")
    throw new HttpError(
      400,
      "LAST_OWNER",
      "The organization must retain at least one owner."
    );
};

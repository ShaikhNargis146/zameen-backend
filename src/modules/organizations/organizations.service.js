import { HttpError } from "../../shared/http.js";
import { parsePagination, paginationMeta, splitCountedRows } from "../../shared/pagination.js";
import { signedReadUrl } from "../../utils/storage.js";
import { grantFreePlan, resolveTeamMemberLimit } from "../commerce/entitlements.service.js";
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

export const create = async ({ actorId, input }) => {
  const organization = await repository.createWithOwner({ ...input, createdByUserId: actorId });
  // Symmetric with auth.service.js#verifyOtp granting individuals a FREE
  // plan on registration — same no-op-if-not-seeded tolerance, see
  // entitlements.service.js#grantFreePlan.
  await grantFreePlan({ organizationId: organization.id });
  return withLogoUrl(organization);
};

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

// Platform-wide — unlike listMine/get above, not scoped to the caller's own
// memberships, so a PENDING/SUSPENDED org is visible to admin review here
// even without an active membership on it.
export const adminList = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const counted = await repository.listAdmin(filters, { limit, offset });
  const { data: rows, total } = splitCountedRows(counted);
  const data = await Promise.all(rows.map(withLogoUrl));
  return { data, meta: paginationMeta({ page, limit, total }) };
};

// Shared by listMembers (self-service, membership-gated) and adminGet
// (admin, no gate) so both return the same member DTO shape.
const toMemberDtos = rows =>
  rows.map(({ id, name, phone, email, role, status, joinedAt }) => ({
    user: { id, name, phone, email },
    role,
    status,
    joinedAt
  }));

// Inlines the member list (unlike the public get(), which never includes
// members — that's a separate, membership-gated GET .../members call an
// admin can't use here anyway, since they're not necessarily a member of
// the org they're reviewing).
export const adminGet = async organizationId => {
  const organization = await repository.findByIdForAdmin(organizationId);
  if (!organization) throw notFound();
  const rows = await repository.listMembers(organizationId);
  return { ...(await withLogoUrl(organization)), members: toMemberDtos(rows) };
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

// Unlike channel-partners' 4-status model (PENDING/APPROVED/REJECTED/
// SUSPENDED), organizations only has 3 (schema.sql's CHECK constraint on
// account.organizations.status: PENDING/ACTIVE/SUSPENDED) — there's no
// separate REJECTED, so suspend doubles as "reject a pending org" and
// "shut down an active one", both landing in SUSPENDED. reinstate has no
// channel-partners equivalent (that module treats SUSPENDED as terminal);
// here it's the only way back from SUSPENDED to ACTIVE.
const orgTransitions = {
  approve: { valid: ["PENDING"], status: "ACTIVE", label: "approved" },
  suspend: { valid: ["PENDING", "ACTIVE"], status: "SUSPENDED", label: "suspended" },
  reinstate: { valid: ["SUSPENDED"], status: "ACTIVE", label: "reinstated" }
};

export const transition = async ({ actorId, organizationId, action, note, request }) => {
  const rule = orgTransitions[action];
  const before = await requireOrganization(organizationId);
  const after = await repository.setStatus({
    organizationId,
    status: rule.status,
    validStatuses: rule.valid
  });
  if (!after)
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      `Organization cannot be ${rule.label} from its current state.`
    );
  await repository.audit({
    actorId,
    action: `ORGANIZATION_${rule.label.toUpperCase()}`,
    entityId: organizationId,
    before,
    after: { ...after, note: note || null },
    ...request
  });
  return withLogoUrl(after);
};

export const listMembers = async ({ organizationId, actorId }) => {
  await requireOrganization(organizationId);
  await requireMembership(organizationId, actorId);
  return toMemberDtos(await repository.listMembers(organizationId));
};

// Looks up an existing account by phone number first — a number that already
// belongs to someone just invites that existing account as-is, their name is
// never touched. Only a genuinely new account gets firstName/lastName.
// Grants no platform role (auth.user_roles) — the invited person self-assigns
// one later via users.validation.js#selfRole if/when they need one, same as
// any other self-registered user; this only ever creates the account and the
// org membership.
const resolveInvitedUser = async ({ phone, firstName, lastName }) => {
  const existingUser = await repository.findUserByPhone(phone);
  if (existingUser) return existingUser;
  const created = await repository.createInvitedUser({ phone, firstName, lastName });
  if (created) return created;
  // Lost a create race against a concurrent invite for the same new number.
  const user = await repository.findUserByPhone(phone);
  if (!user)
    throw new HttpError(
      409,
      "ACCOUNT_CREATION_RETRY",
      "Account creation is in progress. Please retry."
    );
  return user;
};

export const addMember = async ({ organizationId, actorId, role, invite }) => {
  requireActiveOrganization(await requireOrganization(organizationId));
  const actorMembership = await requireManager(organizationId, actorId);
  const user = await resolveInvitedUser(invite);
  // role can never literally be "OWNER" (organizations.validation.js#addMember
  // only allows ADMIN/MEMBER), but the invited phone number can still resolve
  // to an EXISTING user who already holds OWNER on this org — changing their role
  // away from OWNER still needs the actor to themselves be an OWNER.
  const existing = await repository.findMembership(organizationId, user.id);
  if (existing?.role === "OWNER" && actorMembership.role !== "OWNER")
    throw new HttpError(
      403,
      "OWNER_ROLE_REQUIRED",
      "Only an existing owner can change another owner's access."
    );
  // Resolved unconditionally (even though it's only applied for a genuinely
  // new member) rather than gated on the `existing` read above: that read
  // happens outside repository.addMember's lock, so by the time the lock is
  // actually held, `existing` could be stale. repository.addMember re-checks
  // membership fresh inside the lock and only applies this limit then — both
  // the owner-count guard and this one are enforced atomically there, not
  // here, so two concurrent invites for different new users can't both pass
  // a stale "under the limit" read before either commits.
  const teamMemberLimit = await resolveTeamMemberLimit(organizationId);
  const { membership, reason, used } = await repository.addMember(organizationId, user.id, role, {
    teamMemberLimit
  });
  if (reason === "LAST_OWNER")
    throw new HttpError(
      400,
      "LAST_OWNER",
      "The organization must retain at least one owner."
    );
  if (reason === "TEAM_LIMIT_REACHED")
    throw new HttpError(
      403,
      "PLAN_LIMIT_REACHED",
      `This organization's plan allows up to ${teamMemberLimit} team members.`,
      { feature: "TEAM_MEMBERS", used, limit: teamMemberLimit, upgradeRequired: true }
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

// Admin-only — bypasses the org's own OWNER/ADMIN requirement (requireManager
// above) entirely, since the route is gated by requireAdmin instead. Unlike
// removeMember (ACTIVE/INVITED -> REMOVED only), this can move a member to
// any of the 3 valid statuses from any current one, including reactivating a
// REMOVED member straight to ACTIVE/INVITED with no fresh invite-accept
// cycle — that's a deliberate admin override, not a self-service path, so
// it's also not re-checked against the org's plan team-member seat limit the
// way addMember's own reactivation path is.
export const adminSetMemberStatus = async ({ organizationId, userId, status, actorId, request }) => {
  await requireOrganization(organizationId);
  const { membership, before, reason } = await repository.setMemberStatus(organizationId, userId, status);
  if (reason === "NOT_FOUND")
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Organization member was not found.");
  if (reason === "LAST_OWNER")
    throw new HttpError(
      400,
      "LAST_OWNER",
      "The organization must retain at least one owner."
    );
  await repository.audit({
    actorId,
    action: "ORGANIZATION_MEMBER_STATUS_CHANGED",
    entityId: organizationId,
    before: { userId, ...before },
    after: { userId, ...membership },
    ...request
  });
  const user = await repository.findUserSummary(userId);
  return { user, role: membership.role, status: membership.status, joinedAt: membership.joinedAt };
};

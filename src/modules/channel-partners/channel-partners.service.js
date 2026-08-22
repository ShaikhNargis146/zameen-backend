import { HttpError } from "../../shared/http.js";
import { paginationMeta, parsePagination } from "../../shared/pagination.js";
import { signedReadUrl } from "../../utils/storage.js";
import { userSummariesByIds } from "../../shared/userSummary.js";
import * as repository from "./channel-partners.repository.js";

const toLocationSummary = row => ({
  id: row.id,
  name: row.name,
  type: row.type,
  parentId: row.parentId,
  stateCode: row.stateCode,
  latitude: row.latitude === null ? null : Number(row.latitude),
  longitude: row.longitude === null ? null : Number(row.longitude),
  displayPath: row.displayPath
});

const toOrganizationDto = async row => {
  if (!row) return null;
  const { logoStorageKey, ...rest } = row;
  return { ...rest, logoUrl: await signedReadUrl(logoStorageKey) };
};

const toProfiles = async rows => {
  if (!rows.length) return [];
  const organizationIds = [...new Set(rows.map(row => row.organizationId).filter(Boolean))];
  const [usersMap, orgRows, locationRows] = await Promise.all([
    userSummariesByIds(rows.map(row => row.userId)),
    repository.organizationsByIds(organizationIds),
    repository.locationsForPartners(rows.map(row => row.userId))
  ]);
  const orgById = new Map(
    await Promise.all(orgRows.map(async row => [row.id, await toOrganizationDto(row)]))
  );
  const locationsByPartner = new Map();
  for (const loc of locationRows) {
    const list = locationsByPartner.get(loc.partnerId) || [];
    list.push(toLocationSummary(loc));
    locationsByPartner.set(loc.partnerId, list);
  }
  return rows.map(row => ({
    user: usersMap.get(row.userId) || null,
    organization: row.organizationId ? orgById.get(row.organizationId) || null : null,
    reraNumber: row.reraNumber,
    experienceYears: row.experienceYears,
    locations: locationsByPartner.get(row.userId) || [],
    status: row.status,
    approvedAt: row.approvedAt
  }));
};
const toProfile = async row => (await toProfiles([row]))[0];

const requireProfile = async userId => {
  const row = await repository.findByUserId(userId);
  if (!row)
    throw new HttpError(
      404,
      "CHANNEL_PARTNER_NOT_FOUND",
      "Channel partner profile was not found."
    );
  return row;
};

const mapReferenceError = error => {
  if (error?.code === "23505")
    throw new HttpError(
      409,
      "ALREADY_APPLIED",
      "A channel partner application already exists for this user."
    );
  if (error?.code === "23503")
    throw new HttpError(
      400,
      "INVALID_REFERENCE",
      "organizationId or one of the locationIds does not exist."
    );
  throw error;
};

export const apply = async ({ actorId, input }) => {
  try {
    await repository.createProfile({ userId: actorId, ...input });
  } catch (error) {
    mapReferenceError(error);
  }
  return toProfile(await repository.findByUserId(actorId));
};

export const me = async actorId => toProfile(await requireProfile(actorId));

export const updateMe = async ({ actorId, changes }) => {
  await requireProfile(actorId);
  const { locationIds, ...fieldChanges } = changes;
  try {
    if (Object.keys(fieldChanges).length) {
      const result = await repository.updateProfileFields(actorId, fieldChanges);
      if (!result.ok) throw result.error;
    }
    if (locationIds !== undefined) await repository.replaceLocations(actorId, locationIds);
  } catch (error) {
    mapReferenceError(error);
  }
  return toProfile(await repository.findByUserId(actorId));
};

export const adminList = async ({ filters, query }) => {
  const { page, limit, offset } = parsePagination(query);
  const rows = await repository.listAdmin({ ...filters, limit, offset });
  const total = rows[0]?.total || 0;
  return { data: await toProfiles(rows), meta: paginationMeta({ page, limit, total }) };
};

export const adminGet = async partnerId => toProfile(await requireProfile(partnerId));

const transitions = {
  approve: { valid: ["PENDING"], status: "APPROVED", label: "approved" },
  reject: { valid: ["PENDING"], status: "REJECTED", label: "rejected" },
  suspend: { valid: ["APPROVED"], status: "SUSPENDED", label: "suspended" }
};

export const transition = async ({ partnerId, action, actorId, note }) => {
  const rule = transitions[action];
  const before = await requireProfile(partnerId);
  const updated = await repository.setStatus({
    userId: partnerId,
    status: rule.status,
    validStatuses: rule.valid,
    approvedByUserId: action === "approve" ? actorId : null,
    setApprovedAt: action === "approve"
  });
  if (!updated)
    throw new HttpError(
      409,
      "INVALID_TRANSITION",
      `Channel partner cannot be ${rule.label} from its current state.`
    );
  if (action === "approve") await repository.grantChannelPartnerRole(partnerId);
  if (action === "suspend") await repository.revokeChannelPartnerRole(partnerId);
  const after = await repository.findByUserId(partnerId);
  await repository.audit({
    actorId,
    action: `CHANNEL_PARTNER_${rule.label.toUpperCase()}`,
    partnerId,
    before,
    after,
    note
  });
  return toProfile(after);
};

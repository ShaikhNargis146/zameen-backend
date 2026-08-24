import { run } from "./db.js";
import { signedReadUrl } from "../utils/storage.js";

const summaryQuery = `
  SELECT u.id, u.display_name AS "displayName", u.phone_e164 AS "phoneE164", u.email::text AS email,
         u.avatar_storage_key AS "avatarUrl", u.preferred_language AS "preferredLanguage", u.status,
         COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
  FROM auth.users u
  LEFT JOIN auth.user_roles ur ON ur.user_id = u.id
  LEFT JOIN auth.roles r ON r.id = ur.role_id
  WHERE u.id = ANY($1::uuid[]) AND u.deleted_at IS NULL
  GROUP BY u.id
`;

const toUserSummary = async row => ({
  id: row.id,
  displayName: row.displayName,
  phoneE164: row.phoneE164,
  email: row.email,
  avatarUrl: await signedReadUrl(row.avatarUrl),
  roles: row.roles,
  status: row.status,
  preferredLanguage: row.preferredLanguage
});

/**
 * Batch-loads UserSummary projections keyed by user id, for callers that
 * need to project several user references (buyer/assignedTo/createdBy) at
 * once without an N+1 query per row.
 */
export const userSummariesByIds = async userIds => {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await run("any", summaryQuery, [ids]);
  const entries = await Promise.all(
    rows.map(async row => [row.id, await toUserSummary(row)])
  );
  return new Map(entries);
};

export const userSummaryById = async userId => {
  if (!userId) return null;
  const summaries = await userSummariesByIds([userId]);
  return summaries.get(userId) || null;
};

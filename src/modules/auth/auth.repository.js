import pg from "../../utils/postgres_store.js";

const run = async (method, sql, params = []) => {
  const result = await pg[method](sql, params);
  if (!result.ok) throw result.error;
  return result.data;
};

const destinationColumn = channel =>
  channel === "SMS" ? "phone_e164" : "email";
export const rolesForUser = async userId =>
  (
    await run(
      "any",
      `SELECT r.code FROM auth.user_roles ur JOIN auth.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.code`,
      [userId]
    )
  ).map(row => row.code);
export const countRecentChallenges = destination =>
  run(
    "one",
    `SELECT count(*)::int AS count FROM auth.otp_challenges WHERE destination = $1 AND created_at > now() - interval '10 minutes'`,
    [destination]
  );
export const findUserByDestination = (destination, channel) =>
  run(
    "oneOrNone",
    `SELECT id FROM auth.users WHERE ${destinationColumn(
      channel
    )} = $1 AND deleted_at IS NULL`,
    [destination]
  );
export const createChallenge = input =>
  run(
    "one",
    `INSERT INTO auth.otp_challenges (user_id, destination, channel, purpose, otp_hash, expires_at, max_attempts) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, expires_at`,
    [
      input.userId,
      input.destination,
      input.channel,
      input.purpose,
      input.otpHash,
      input.expiresAt,
      input.maxAttempts
    ]
  );
export const latestChallenge = ({ destination, channel, purpose }) =>
  run(
    "oneOrNone",
    `SELECT id, user_id, otp_hash, expires_at, verified_at, attempt_count, max_attempts FROM auth.otp_challenges WHERE destination = $1 AND channel = $2 AND purpose = $3 ORDER BY created_at DESC LIMIT 1`,
    [destination, channel, purpose]
  );
export const challengeById = id =>
  run(
    "oneOrNone",
    `SELECT id, user_id, destination, channel, purpose, otp_hash, expires_at, verified_at, attempt_count, max_attempts FROM auth.otp_challenges WHERE id = $1`,
    [id]
  );
export const recordFailedAttempt = id =>
  run(
    "oneOrNone",
    `UPDATE auth.otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1 AND verified_at IS NULL AND expires_at > now() AND attempt_count < max_attempts RETURNING attempt_count, max_attempts`,
    [id]
  );
export const consumeChallenge = (id, otpHash) =>
  run(
    "oneOrNone",
    `UPDATE auth.otp_challenges SET verified_at = now() WHERE id = $1 AND verified_at IS NULL AND expires_at > now() AND attempt_count < max_attempts AND otp_hash = $2 RETURNING user_id`,
    [id, otpHash]
  );
export const createUser = ({ destination, channel, name }) =>
  run(
    "oneOrNone",
    `INSERT INTO auth.users (phone_e164, email, display_name, phone_verified_at, email_verified_at) VALUES ($1, $2, $3, CASE WHEN $1 IS NULL THEN NULL ELSE now() END, CASE WHEN $2 IS NULL THEN NULL ELSE now() END) ON CONFLICT DO NOTHING RETURNING id`,
    [
      channel === "SMS" ? destination : null,
      channel === "EMAIL" ? destination : null,
      name
    ]
  );
export const addBuyerRole = userId =>
  run(
    "none",
    `INSERT INTO auth.user_roles (user_id, role_id) SELECT $1, id FROM auth.roles WHERE code = 'BUYER' ON CONFLICT DO NOTHING`,
    [userId]
  );
export const findActiveUser = id =>
  run(
    "oneOrNone",
    `SELECT id, first_name, last_name, display_name, phone_e164, email, avatar_storage_key, preferred_language, status FROM auth.users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
export const createRefreshSession = input =>
  run(
    "one",
    `INSERT INTO auth.refresh_sessions (user_id, token_hash, device_id, device_name, ip_address, user_agent, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, expires_at`,
    [
      input.userId,
      input.tokenHash,
      input.deviceId,
      input.deviceName,
      input.ip,
      input.userAgent,
      input.expiresAt
    ]
  );
export const updateLastLogin = id =>
  run("none", `UPDATE auth.users SET last_login_at = now() WHERE id = $1`, [
    id
  ]);
export const findRefreshSession = hash =>
  run(
    "oneOrNone",
    `SELECT id, user_id FROM auth.refresh_sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hash]
  );
export const revokeSession = id =>
  run(
    "none",
    `UPDATE auth.refresh_sessions SET revoked_at = now(), last_used_at = now() WHERE id = $1`,
    [id]
  );
export const revokeUserSessions = id =>
  run(
    "none",
    `UPDATE auth.refresh_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [id]
  );
export const authenticatedSession = ({ sessionId, userId }) =>
  run(
    "oneOrNone",
    `SELECT s.id, u.id, u.display_name, u.phone_e164, u.email, u.preferred_language, u.status FROM auth.refresh_sessions s JOIN auth.users u ON u.id = s.user_id WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [sessionId, userId]
  );

import { HttpError } from "../../shared/http.js";
import { hashWithPepper, safeEqualHex } from "../../utils/crypto.js";
import AuthService, { rolesFor } from "../auth/auth.service.js";
import * as authRepository from "../auth/auth.repository.js";
import * as repository from "./users.repository.js";

const EMAIL_CHANGE_PURPOSE = "VERIFY_EMAIL";

const withRoles = async user =>
  user ? { ...user, roles: await rolesFor(user.id) } : null;
export const profile = async id => withRoles(await repository.findUser(id));
export const roleDetails = repository.roleDetailsForUser;
export const updateProfile = async (id, changes) => {
  const result = await repository.updateProfile(id, changes);
  if (!result.ok) {
    if (result.error?.code === "23505")
      throw new HttpError(409, "EMAIL_IN_USE", "Email is already in use.");
    throw result.error;
  }
  const user = await profile(id);
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
  return user;
};
// Step 1 of a verified email change: send an OTP to the NEW address. Reuses
// AuthService.requestOtp for its cooldown/rate-limit/delivery logic, just
// not its login/account-creation side effects (confirmEmailChange below
// handles the outcome itself instead of AuthService.verifyOtp).
export const requestEmailChange = async ({ actorId, email, ip }) => {
  const existing = await authRepository.findUserByDestination(email, "EMAIL");
  if (existing && existing.id !== actorId)
    throw new HttpError(409, "EMAIL_IN_USE", "Email is already in use.");
  const result = await AuthService.requestOtp({
    email,
    purpose: EMAIL_CHANGE_PURPOSE,
    ip
  });
  if (!result.ok) throw new HttpError(result.status, result.code, result.message);
  return result.data;
};

// Step 2: the OTP that only the new address's real owner could have
// received is what proves ownership — the change is applied to whoever is
// currently authenticated (actorId), not to anything read off the
// challenge, so there is nothing here an attacker could redirect to a
// different account by supplying their own challengeId/otp pair (they'd
// need the code delivered to the address they don't control either way).
export const confirmEmailChange = async ({ actorId, challengeId, otp }) => {
  const challenge = await authRepository.challengeById(challengeId);
  if (
    !challenge ||
    challenge.purpose !== EMAIL_CHANGE_PURPOSE ||
    challenge.verified_at ||
    new Date(challenge.expires_at) <= new Date()
  )
    throw new HttpError(410, "OTP_EXPIRED", "OTP has expired.");
  if (challenge.attempt_count >= challenge.max_attempts)
    throw new HttpError(429, "OTP_MAX_ATTEMPTS", "Too many OTP attempts.");
  const expected = hashWithPepper(
    `${challenge.destination}:${challenge.purpose}:${otp}`
  );
  if (!safeEqualHex(challenge.otp_hash, expected)) {
    const failed = await authRepository.recordFailedAttempt(challenge.id);
    if (!failed || failed.attempt_count >= failed.max_attempts)
      throw new HttpError(429, "OTP_MAX_ATTEMPTS", "Too many OTP attempts.");
    throw new HttpError(401, "INVALID_OTP", "Invalid OTP.");
  }
  const verified = await authRepository.consumeChallenge(challenge.id, expected);
  if (!verified)
    throw new HttpError(
      410,
      "OTP_UNAVAILABLE",
      "OTP has expired or was already used."
    );
  const result = await repository.setVerifiedEmail(actorId, challenge.destination);
  if (!result.ok) {
    if (result.error?.code === "23505")
      throw new HttpError(409, "EMAIL_IN_USE", "Email is already in use.");
    throw result.error;
  }
  const user = await profile(actorId);
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
  return user;
};

export const addSelfRole = async (id, role) => {
  await repository.addRole(id, role);
  return roleDetails(id);
};
export const adminList = async input => {
  const offset = (input.page - 1) * input.limit;
  const [items, count] = await Promise.all([
    repository.listUsers({ ...input, offset }),
    repository.countUsers(input)
  ]);
  return { items, total: count.total };
};
export const adminGet = async id => {
  const user = await profile(id);
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
  return user;
};
export const changeStatus = async ({
  actorId,
  userId,
  status,
  reason,
  request
}) => {
  if (actorId === userId && status !== "ACTIVE")
    throw new HttpError(
      400,
      "SELF_STATUS_CHANGE_DENIED",
      "You cannot deactivate your own account."
    );
  const before = await adminGet(userId);
  const updated = await repository.setUserStatus(userId, status);
  if (!updated)
    throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
  if (status !== "ACTIVE") await repository.revokeSessions(userId);
  const after = await adminGet(userId);
  await repository.audit({
    actorId,
    action: "USER_STATUS_CHANGED",
    entityId: userId,
    before,
    after: { ...after, auditReason: reason },
    ...request
  });
  return after;
};
export const changeRoles = async ({
  actorId,
  userId,
  roleCodes,
  reason,
  request
}) => {
  if (actorId === userId && !roleCodes.includes("ADMIN"))
    throw new HttpError(
      400,
      "SELF_ROLE_CHANGE_DENIED",
      "You cannot remove your own ADMIN role."
    );
  const before = await adminGet(userId);
  const roles = await repository.findRoles(roleCodes);
  if (roles.length !== roleCodes.length)
    throw new HttpError(400, "INVALID_ROLE", "One or more roles are invalid.");
  await repository.replaceRoles(userId, roles);
  const after = await adminGet(userId);
  await repository.audit({
    actorId,
    action: "USER_ROLES_CHANGED",
    entityId: userId,
    before,
    after: { ...after, auditReason: reason },
    ...request
  });
  return after;
};

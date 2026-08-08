import { HttpError } from "../../shared/http.js";
import { rolesFor } from "../auth/auth.service.js";
import * as repository from "./users.repository.js";

const withRoles = async user =>
  user ? { ...user, roles: await rolesFor(user.id) } : null;
export const profile = async id => withRoles(await repository.findUser(id));
export const updateProfile = async (id, changes) => {
  const result = await repository.updateProfile(id, changes);
  if (!result.ok) {
    if (result.error?.code === "23505")
      throw new HttpError(409, "EMAIL_IN_USE", "Email is already in use.");
    throw result.error;
  }
  return profile(id);
};
export const addSelfRole = async (id, role) => {
  await repository.addRole(id, role);
  return rolesFor(id);
};
export const adminList = async input => repository.listUsers(input);
export const adminGet = async id => {
  const user = await profile(id);
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
  return user;
};
export const changeStatus = async ({ actorId, userId, status, request }) => {
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
    after,
    ...request
  });
  return after;
};
export const changeRoles = async ({ actorId, userId, roleCodes, request }) => {
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
    after,
    ...request
  });
  return after;
};

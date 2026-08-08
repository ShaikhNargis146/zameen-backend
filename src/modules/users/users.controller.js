import { ok } from "../../shared/http.js";
import * as service from "./users.service.js";
import * as validation from "./users.validation.js";

const requestAudit = req => ({
  ip: req.ip,
  requestId: req.headers["x-request-id"] || null
});
export const me = async (req, res) =>
  ok(res, await service.profile(req.actor.id));
export const updateMe = async (req, res) =>
  ok(
    res,
    await service.updateProfile(
      req.actor.id,
      validation.profileChanges(req.body || {})
    )
  );
export const myRoles = async (req, res) =>
  ok(res, { roles: (await service.profile(req.actor.id)).roles });
export const addMyRole = async (req, res) =>
  ok(res, {
    roles: await service.addSelfRole(
      req.actor.id,
      validation.selfRole(req.body || {})
    )
  });
export const list = async (req, res) => {
  const query = validation.adminListQuery(req.query);
  return ok(res, await service.adminList(query), {
    limit: query.limit,
    offset: query.offset
  });
};
export const get = async (req, res) =>
  ok(res, await service.adminGet(req.params.userId));
export const status = async (req, res) =>
  ok(
    res,
    await service.changeStatus({
      actorId: req.actor.id,
      userId: req.params.userId,
      status: validation.userStatus(req.body || {}),
      request: requestAudit(req)
    })
  );
export const roles = async (req, res) =>
  ok(
    res,
    await service.changeRoles({
      actorId: req.actor.id,
      userId: req.params.userId,
      roleCodes: validation.roles(req.body || {}),
      request: requestAudit(req)
    })
  );

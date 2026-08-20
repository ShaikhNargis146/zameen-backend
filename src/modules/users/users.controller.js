import { ok, paginationMeta } from "../../shared/http.js";
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
  ok(res, await service.roleDetails(req.actor.id));
export const addMyRole = async (req, res) =>
  ok(
    res,
    await service.addSelfRole(req.actor.id, validation.selfRole(req.body || {}))
  );
export const list = async (req, res) => {
  const query = validation.adminListQuery(req.query);
  const result = await service.adminList(query);
  return ok(
    res,
    result.items,
    paginationMeta({
      page: query.page,
      limit: query.limit,
      total: result.total
    })
  );
};
export const get = async (req, res) =>
  ok(res, await service.adminGet(req.params.userId));
export const status = async (req, res) => {
  const change = validation.userStatus(req.body || {});
  return ok(
    res,
    await service.changeStatus({
      actorId: req.actor.id,
      userId: req.params.userId,
      ...change,
      request: requestAudit(req)
    })
  );
};
export const roles = async (req, res) => {
  const change = validation.roles(req.body || {});
  return ok(
    res,
    await service.changeRoles({
      actorId: req.actor.id,
      userId: req.params.userId,
      ...change,
      request: requestAudit(req)
    })
  );
};

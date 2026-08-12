import { ok, created } from "../../shared/http.js";
import * as service from "./organizations.service.js";
import * as validation from "./organizations.validation.js";

export const create = async (req, res) =>
  created(
    res,
    await service.create({
      actorId: req.actor.id,
      input: validation.createOrganization(req.body || {})
    })
  );

export const listMine = async (req, res) => {
  const { data, meta } = await service.listMine({
    actorId: req.actor.id,
    filters: validation.listMineQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const get = async (req, res) =>
  ok(
    res,
    await service.get({
      organizationId: validation.uuid(
        req.params.organizationId,
        "organizationId"
      ),
      actorId: req.actor?.id || null
    })
  );

export const update = async (req, res) =>
  ok(
    res,
    await service.update({
      organizationId: validation.uuid(
        req.params.organizationId,
        "organizationId"
      ),
      actorId: req.actor.id,
      changes: validation.updateOrganization(req.body || {})
    })
  );

export const adminChangeStatus = async (req, res) =>
  ok(
    res,
    await service.changeStatus({
      actorId: req.actor.id,
      organizationId: validation.uuid(
        req.params.organizationId,
        "organizationId"
      ),
      status: validation.organizationStatus(req.body || {}),
      request: { ip: req.ip, requestId: req.headers["x-request-id"] || null }
    })
  );

export const listMembers = async (req, res) =>
  ok(
    res,
    await service.listMembers({
      organizationId: validation.uuid(
        req.params.organizationId,
        "organizationId"
      ),
      actorId: req.actor.id
    })
  );

export const addMember = async (req, res) =>
  created(
    res,
    await service.addMember({
      organizationId: validation.uuid(
        req.params.organizationId,
        "organizationId"
      ),
      actorId: req.actor.id,
      ...validation.addMember(req.body || {})
    })
  );

export const removeMember = async (req, res) => {
  await service.removeMember({
    organizationId: validation.uuid(
      req.params.organizationId,
      "organizationId"
    ),
    actorId: req.actor.id,
    userId: validation.uuid(req.params.userId, "userId")
  });
  res.status(204).end();
};

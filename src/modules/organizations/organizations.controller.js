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

export const adminList = async (req, res) => {
  const { data, meta } = await service.adminList({
    filters: validation.adminListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const adminGet = async (req, res) =>
  ok(
    res,
    await service.adminGet(
      validation.uuid(req.params.organizationId, "organizationId")
    )
  );

const requestMeta = req => ({ ip: req.ip, requestId: req.headers["x-request-id"] || null });

export const approve = async (req, res) =>
  ok(
    res,
    await service.transition({
      organizationId: validation.uuid(req.params.organizationId, "organizationId"),
      action: "approve",
      actorId: req.actor.id,
      note: validation.adminOrgAction(req.body || {}).note,
      request: requestMeta(req)
    })
  );

export const suspend = async (req, res) =>
  ok(
    res,
    await service.transition({
      organizationId: validation.uuid(req.params.organizationId, "organizationId"),
      action: "suspend",
      actorId: req.actor.id,
      note: validation.actionReason(req.body || {}).reason,
      request: requestMeta(req)
    })
  );

export const reinstate = async (req, res) =>
  ok(
    res,
    await service.transition({
      organizationId: validation.uuid(req.params.organizationId, "organizationId"),
      action: "reinstate",
      actorId: req.actor.id,
      note: validation.adminOrgAction(req.body || {}).note,
      request: requestMeta(req)
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

export const acceptMembership = async (req, res) =>
  ok(
    res,
    await service.acceptMembership({
      organizationId: validation.uuid(
        req.params.organizationId,
        "organizationId"
      ),
      actorId: req.actor.id
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

export const adminMemberStatus = async (req, res) =>
  ok(
    res,
    await service.adminSetMemberStatus({
      organizationId: validation.uuid(req.params.organizationId, "organizationId"),
      userId: validation.uuid(req.params.userId, "userId"),
      status: validation.memberStatus(req.body || {}),
      actorId: req.actor.id,
      request: requestMeta(req)
    })
  );

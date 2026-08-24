import { created, ok } from "../../shared/http.js";
import * as service from "./investment-opportunities.service.js";
import * as validation from "./investment-opportunities.validation.js";

const isAdmin = req => Boolean(req.actor?.roles?.includes("ADMIN"));

export const list = async (req, res) => {
  const { data, meta } = await service.list({
    filters: validation.opportunityListQuery(req.query || {}, { isAdmin: isAdmin(req) }),
    query: req.query
  });
  ok(res, data, meta);
};

export const detail = async (req, res) =>
  ok(
    res,
    await service.detail({
      id: validation.uuid(req.params.opportunityId, "opportunityId"),
      isAdmin: isAdmin(req)
    })
  );

export const createInterest = async (req, res) =>
  created(
    res,
    await service.createInterest({
      opportunityId: validation.uuid(req.params.opportunityId, "opportunityId"),
      actorId: req.actor.id,
      input: validation.interestInput(req.body || {})
    })
  );

export const create = async (req, res) =>
  created(
    res,
    await service.create({
      actorId: req.actor.id,
      input: validation.createOpportunity(req.body || {})
    })
  );

export const update = async (req, res) =>
  ok(
    res,
    await service.update({
      id: validation.uuid(req.params.id, "id"),
      changes: validation.updateOpportunity(req.body || {})
    })
  );

export const publish = async (req, res) =>
  ok(
    res,
    await service.transition({
      id: validation.uuid(req.params.id, "id"),
      action: "publish",
      actorId: req.actor.id,
      note: null
    })
  );

export const close = async (req, res) =>
  ok(
    res,
    await service.transition({
      id: validation.uuid(req.params.id, "id"),
      action: "close",
      actorId: req.actor.id,
      note: validation.optionalActionReason(req.body || {}).reason
    })
  );

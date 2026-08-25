import { ok, created } from "../../shared/http.js";
import * as service from "./buyer-requirements.service.js";
import * as validation from "./buyer-requirements.validation.js";

export const create = async (req, res) =>
  created(
    res,
    await service.create({
      actorId: req.actor.id,
      input: validation.buyerRequirementInput(req.body || {})
    })
  );

export const list = async (req, res) => {
  const { data, meta } = await service.list({
    actorId: req.actor.id,
    filters: validation.listQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const get = async (req, res) => ok(res, service.get(req.requirement));

export const update = async (req, res) =>
  ok(
    res,
    await service.update({
      requirement: req.requirement,
      changes: validation.buyerRequirementChanges(req.body || {})
    })
  );

export const remove = async (req, res) => {
  await service.remove(req.requirement);
  res.status(204).end();
};

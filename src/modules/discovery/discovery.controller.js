import { ok } from "../../shared/http.js";
import * as service from "./discovery.service.js";
import * as validation from "./discovery.validation.js";

export const search = async (req, res) => {
  const result = await service.search({
    filters: validation.search(req.body || {}),
    actorId: req.actor?.id || null
  });
  return ok(res, result.data, result.meta);
};
export const suggestions = async (req, res) =>
  ok(res, await service.suggestions(validation.suggestions(req.query || {})));
export const map = async (req, res) =>
  ok(res, await service.map(validation.map(req.body || {})));
export const similar = async (req, res) =>
  ok(
    res,
    await service.similar({
      listingId: validation.listingId(req.params.listingId),
      limit: Math.min(Math.max(Number(req.query.limit || 10), 1), 25),
      actorId: req.actor?.id || null
    })
  );
export const compare = async (req, res) =>
  ok(
    res,
    await service.compare({
      listingIds: validation.compare(req.body || {}),
      actorId: req.actor?.id || null
    })
  );

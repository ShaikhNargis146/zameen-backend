import { created, ok } from "../../shared/http.js";
import * as service from "./ads.service.js";
import * as validation from "./ads.validation.js";

export const list = async (req, res) =>
  ok(res, await service.listActive(validation.placement(req.query.placement)));

export const create = async (req, res) =>
  created(res, await service.create(validation.createAd(req.body || {})));

export const update = async (req, res) =>
  ok(
    res,
    await service.update({
      id: validation.uuid(req.params.adId, "adId"),
      changes: validation.updateAd(req.body || {})
    })
  );

export const remove = async (req, res) => {
  await service.remove(validation.uuid(req.params.adId, "adId"));
  res.status(204).send();
};

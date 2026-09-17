import { created, ok } from "../../shared/http.js";
import * as service from "./ads.service.js";
import * as validation from "./ads.validation.js";

export const list = async (req, res) =>
  ok(res, await service.listActive(validation.placement(req.query.placement)));

export const adminList = async (req, res) => {
  const { data, meta } = await service.adminList({
    filters: validation.adminAdListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const adminGet = async (req, res) =>
  ok(res, await service.adminGet(validation.uuid(req.params.adId, "adId")));

export const mediaUploadUrl = async (req, res) =>
  ok(res, await service.createMediaUpload(validation.mediaUploadInit(req.body || {})));

export const completeMediaUpload = async (req, res) =>
  created(res, await service.completeMediaUpload(validation.mediaComplete(req.body || {})));

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

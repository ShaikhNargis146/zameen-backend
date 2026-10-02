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

export const mediaUploadUrl = async (req, res) => {
  const batch = Array.isArray(req.body?.files);
  const input = validation.mediaUpload(req.body || {});
  const tickets = await service.createMediaUpload({ adId: req.ad.id, input });
  return ok(res, batch ? { files: tickets } : tickets);
};

export const completeMediaUpload = async (req, res) => {
  const batch = Array.isArray(req.body?.files);
  const input = validation.mediaComplete(req.body || {});
  const items = await service.completeMediaUpload({ adId: req.ad.id, actorId: req.actor.id, input });
  return created(res, batch ? { files: items } : items);
};

export const media = async (req, res) => ok(res, await service.listMedia(req.ad.id));

export const updateMedia = async (req, res) =>
  ok(
    res,
    await service.updateMedia({
      adId: req.ad.id,
      mediaId: req.params.mediaId,
      changes: validation.mediaUpdate(req.body || {})
    })
  );

export const deleteMedia = async (req, res) => {
  await service.deleteMedia({ adId: req.ad.id, mediaId: req.params.mediaId });
  return res.status(204).send();
};

export const orderMedia = async (req, res) =>
  ok(res, await service.reorderMedia({ adId: req.ad.id, mediaIds: validation.mediaOrder(req.body || {}) }));

export const coverMedia = async (req, res) =>
  ok(res, await service.setMediaCover({ adId: req.ad.id, mediaId: req.params.mediaId }));

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

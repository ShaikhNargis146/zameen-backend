import { created, ok } from "../../shared/http.js";
import * as service from "./auctions.service.js";
import * as validation from "./auctions.validation.js";

export const list = async (req, res) => {
  const { data, meta } = await service.list({
    filters: validation.auctionListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const detail = async (req, res) =>
  ok(res, await service.detail(validation.uuid(req.params.auctionId, "auctionId")));

export const create = async (req, res) =>
  created(res, await service.create(validation.createAuction(req.body || {})));

export const update = async (req, res) =>
  ok(
    res,
    await service.update({
      id: validation.uuid(req.params.auctionId, "auctionId"),
      changes: validation.updateAuction(req.body || {})
    })
  );

export const remove = async (req, res) => {
  await service.remove(validation.uuid(req.params.auctionId, "auctionId"));
  res.status(204).send();
};

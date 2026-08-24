import { ok } from "../../shared/http.js";
import { listingFilterQuery } from "../../shared/listingFilters.js";
import * as service from "./favorites.service.js";
import { uuid } from "./favorites.validation.js";

export const add = async (req, res) =>
  ok(
    res,
    await service.addFavorite({
      actorId: req.actor.id,
      listingId: uuid(req.params.listingId, "listingId")
    })
  );

export const remove = async (req, res) => {
  await service.removeFavorite({
    actorId: req.actor.id,
    listingId: uuid(req.params.listingId, "listingId")
  });
  res.status(204).end();
};

export const list = async (req, res) => {
  const { data, meta } = await service.listFavorites({
    actorId: req.actor.id,
    filters: listingFilterQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

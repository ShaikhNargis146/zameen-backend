import { ok } from "../../shared/http.js";
import { listingFilterQuery } from "../../shared/listingFilters.js";
import * as service from "./recently-viewed.service.js";
import { uuid } from "./recently-viewed.validation.js";

export const record = async (req, res) => {
  await service.recordView({
    actorId: req.actor?.id || null,
    listingId: uuid(req.params.listingId, "listingId")
  });
  res.status(204).end();
};

export const list = async (req, res) => {
  const { data, meta } = await service.listRecentlyViewed({
    actorId: req.actor.id,
    filters: listingFilterQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

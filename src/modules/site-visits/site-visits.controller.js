import { created, ok } from "../../shared/http.js";
import * as service from "./site-visits.service.js";
import * as validation from "./site-visits.validation.js";

export const create = async (req, res) =>
  created(
    res,
    await service.create({
      actorId: req.actor.id,
      listingId: validation.uuid(req.params.listingId, "listingId"),
      input: validation.createSiteVisit(req.body || {})
    })
  );

export const buyerList = async (req, res) => {
  const { data, meta } = await service.listForBuyer({
    actorId: req.actor.id,
    filters: validation.visitListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const sellerList = async (req, res) => {
  const { data, meta } = await service.listForSeller({
    actorId: req.actor.id,
    filters: validation.visitListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const confirm = async (req, res) =>
  ok(
    res,
    await service.confirm({
      visit: req.siteVisit,
      ...validation.confirmSiteVisit(req.body || {})
    })
  );

export const reschedule = async (req, res) =>
  ok(
    res,
    await service.reschedule({
      visit: req.siteVisit,
      actorId: req.actor.id,
      ...validation.rescheduleSiteVisit(req.body || {})
    })
  );

export const cancel = async (req, res) =>
  ok(
    res,
    await service.cancel({
      visit: req.siteVisit,
      actorId: req.actor.id,
      ...validation.cancelSiteVisit(req.body || {})
    })
  );

export const complete = async (req, res) =>
  ok(
    res,
    await service.complete({
      visit: req.siteVisit,
      ...validation.completeSiteVisit(req.body || {})
    })
  );

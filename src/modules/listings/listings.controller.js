import { created, ok, paginationMeta } from "../../shared/http.js";
import * as service from "./listings.service.js";
import * as validation from "./listings.validation.js";

export const create = async (req, res) =>
  created(
    res,
    await service.create({
      propertyId: req.params.propertyId,
      actorId: req.actor.id,
      input: validation.create(req.body || {})
    })
  );
export const get = async (req, res) =>
  ok(res, await service.summary(req.listing.id));
export const update = async (req, res) =>
  ok(
    res,
    await service.update({
      listing: req.listing,
      changes: validation.update(req.body || {})
    })
  );
export const remove = async (req, res) => {
  await service.remove(req.listing);
  return res.status(204).send();
};
export const submit = async (req, res) =>
  ok(res, await service.submit(req.listing));
export const pause = async (req, res) =>
  ok(
    res,
    await service.transition({
      listing: req.listing,
      action: "pause",
      actorId: req.actor.id
    })
  );
export const resume = async (req, res) =>
  ok(
    res,
    await service.transition({
      listing: req.listing,
      action: "resume",
      actorId: req.actor.id
    })
  );
export const withdraw = async (req, res) =>
  ok(
    res,
    await service.transition({
      listing: req.listing,
      action: "withdraw",
      actorId: req.actor.id,
      reason: validation.optionalReason(req.body || {})
    })
  );
export const markSold = async (req, res) =>
  ok(
    res,
    await service.transition({
      listing: req.listing,
      action: "sold",
      actorId: req.actor.id,
      reason: validation.optionalReason(req.body || {})
    })
  );
export const sellerListings = async (req, res) => {
  const input = validation.sellerList(req.query);
  const result = await service.sellerListings({
    userId: req.actor.id,
    ...input
  });
  return ok(res, result.items, paginationMeta(result));
};
export const detail = async (req, res) =>
  ok(
    res,
    await service.publicDetail(req.params.listingId, req.actor?.id || null)
  );
export const adminListings = async (req, res) => {
  const input = validation.adminList(req.query);
  const result = await service.adminListings(input);
  return ok(res, result.items, paginationMeta(result));
};
export const adminListing = async (req, res) =>
  ok(res, await service.adminListing(req.params.listingId));
export const approve = async (req, res) =>
  ok(
    res,
    await service.approve({
      id: req.params.listingId,
      approval: validation.approval(req.body || {}),
      actorId: req.actor.id
    })
  );
export const reject = async (req, res) =>
  ok(
    res,
    await service.reject({
      id: req.params.listingId,
      reason: validation.reason(req.body || {}),
      actorId: req.actor.id
    })
  );
export const suspend = async (req, res) =>
  ok(
    res,
    await service.suspend({
      id: req.params.listingId,
      reason: validation.reason(req.body || {}),
      actorId: req.actor.id
    })
  );

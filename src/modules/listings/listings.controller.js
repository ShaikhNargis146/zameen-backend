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
  ok(res, await service.transition(req.listing, "pause"));
export const resume = async (req, res) =>
  ok(res, await service.transition(req.listing, "resume"));
export const withdraw = async (req, res) =>
  ok(res, await service.transition(req.listing, "withdraw"));
export const markSold = async (req, res) =>
  ok(res, await service.transition(req.listing, "sold"));
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
export const adminListings = async (req, res) =>
  ok(res, await service.adminListings(validation.reviewStatus(req.query)));
export const adminListing = async (req, res) =>
  ok(res, await service.adminListing(req.params.listingId));
export const approve = async (req, res) =>
  ok(res, await service.approve(req.params.listingId));
export const reject = async (req, res) =>
  ok(
    res,
    await service.reject(
      req.params.listingId,
      validation.reason(req.body || {})
    )
  );
export const suspend = async (req, res) =>
  ok(res, await service.suspend(req.params.listingId));

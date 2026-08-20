import { created, ok } from "../../shared/http.js";
import * as service from "./enquiries.service.js";
import * as validation from "./enquiries.validation.js";

export const create = async (req, res) =>
  created(
    res,
    await service.create({
      actorId: req.actor.id,
      listingId: validation.uuid(req.params.listingId, "listingId"),
      input: validation.createEnquiry(req.body || {})
    })
  );

export const buyerList = async (req, res) => {
  const { data, meta } = await service.listForBuyer({
    actorId: req.actor.id,
    filters: validation.enquiryListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const buyerDetail = async (req, res) =>
  ok(res, await service.detailForBuyer(req.enquiry));

export const sellerList = async (req, res) => {
  const { data, meta } = await service.listForSeller({
    actorId: req.actor.id,
    filters: validation.sellerEnquiryQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const sellerDetail = async (req, res) =>
  ok(res, await service.detailForSeller(req.enquiry));

export const updateStatus = async (req, res) =>
  ok(
    res,
    await service.updateStatus({
      enquiry: req.enquiry,
      status: validation.updateEnquiryStatus(req.body || {}).status
    })
  );

export const addNote = async (req, res) =>
  created(
    res,
    await service.addNote({
      enquiry: req.enquiry,
      actorId: req.actor.id,
      note: validation.createEnquiryNote(req.body || {}).note
    })
  );

export const contactReveal = async (req, res) =>
  ok(
    res,
    await service.contactReveal({
      actorId: req.actor.id,
      listingId: validation.uuid(req.params.listingId, "listingId"),
      preferredChannel: validation.contactRevealInput(req.body || {}).preferredChannel
    })
  );

import { created, ok } from "../../shared/http.js";
import * as service from "./channel-partners.service.js";
import * as validation from "./channel-partners.validation.js";

export const apply = async (req, res) =>
  created(
    res,
    await service.apply({
      actorId: req.actor.id,
      input: validation.channelPartnerApply(req.body || {})
    })
  );

export const me = async (req, res) => ok(res, await service.me(req.actor.id));

export const updateMe = async (req, res) =>
  ok(
    res,
    await service.updateMe({
      actorId: req.actor.id,
      changes: validation.updateChannelPartner(req.body || {})
    })
  );

export const adminList = async (req, res) => {
  const { data, meta } = await service.adminList({
    filters: validation.partnerListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const adminGet = async (req, res) =>
  ok(res, await service.adminGet(validation.uuid(req.params.partnerId, "partnerId")));

export const approve = async (req, res) =>
  ok(
    res,
    await service.transition({
      partnerId: validation.uuid(req.params.partnerId, "partnerId"),
      action: "approve",
      actorId: req.actor.id,
      note: validation.adminPartnerAction(req.body || {}).note
    })
  );

export const reject = async (req, res) =>
  ok(
    res,
    await service.transition({
      partnerId: validation.uuid(req.params.partnerId, "partnerId"),
      action: "reject",
      actorId: req.actor.id,
      note: validation.actionReason(req.body || {}).reason
    })
  );

export const suspend = async (req, res) =>
  ok(
    res,
    await service.transition({
      partnerId: validation.uuid(req.params.partnerId, "partnerId"),
      action: "suspend",
      actorId: req.actor.id,
      note: validation.actionReason(req.body || {}).reason
    })
  );

import { ok } from "../../shared/http.js";
import * as service from "./verification.service.js";
import * as validation from "./verification.validation.js";

export const list = async (req, res) => {
  const result = await service.list(validation.listQuery(req.query || {}));
  return ok(res, result.data, result.meta);
};
export const get = async (req, res) =>
  ok(res, await service.get(validation.id(req.params.verificationId)));
export const update = async (req, res) =>
  ok(
    res,
    await service.update({
      verificationId: validation.id(req.params.verificationId),
      actorId: req.actor.id,
      changes: validation.update(req.body || {}),
      request: { ip: req.ip, requestId: req.headers["x-request-id"] || null }
    })
  );

import { ok } from "../../shared/http.js";
import * as service from "./seller-dashboard.service.js";
import * as validation from "./seller-dashboard.validation.js";

export const summary = async (req, res) =>
  ok(
    res,
    await service.summary({
      actorId: req.actor.id,
      filters: validation.dashboardQuery(req.query || {})
    })
  );

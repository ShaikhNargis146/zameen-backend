import { Router } from "express";
import { requireOwnedResource } from "../../shared/authorization.js";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth } from "../auth/auth.routes.js";
import * as controller from "./buyer-requirements.controller.js";
import { ownedRequirement } from "./buyer-requirements.service.js";

const router = Router();
const requireOwnedRequirement = requireOwnedResource({
  param: "requirementId",
  target: "requirement",
  load: ownedRequirement
});

router.post("/buyer-requirements", requireAuth, asyncRoute(controller.create));
router.get("/buyer-requirements", requireAuth, asyncRoute(controller.list));
router.get(
  "/buyer-requirements/:requirementId",
  requireAuth,
  requireOwnedRequirement,
  asyncRoute(controller.get)
);
router.patch(
  "/buyer-requirements/:requirementId",
  requireAuth,
  requireOwnedRequirement,
  asyncRoute(controller.update)
);
router.delete(
  "/buyer-requirements/:requirementId",
  requireAuth,
  requireOwnedRequirement,
  asyncRoute(controller.remove)
);

export default router;

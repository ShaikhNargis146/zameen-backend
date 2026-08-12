import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth, optionalAuth } from "../auth/auth.routes.js";
import * as controller from "./organizations.controller.js";

const router = Router();
router.post("/organizations", requireAuth, asyncRoute(controller.create));
router.get(
  "/organizations/me",
  requireAuth,
  asyncRoute(controller.listMine)
);
router.get(
  "/organizations/:organizationId",
  optionalAuth,
  asyncRoute(controller.get)
);
router.patch(
  "/organizations/:organizationId",
  requireAuth,
  asyncRoute(controller.update)
);
router.get(
  "/organizations/:organizationId/members",
  requireAuth,
  asyncRoute(controller.listMembers)
);
router.post(
  "/organizations/:organizationId/members",
  requireAuth,
  asyncRoute(controller.addMember)
);
router.delete(
  "/organizations/:organizationId/members/:userId",
  requireAuth,
  asyncRoute(controller.removeMember)
);

export default router;

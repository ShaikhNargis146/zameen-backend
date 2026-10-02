import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./organizations.controller.js";

const router = Router();
router.get("/organizations", requireAdmin, asyncRoute(controller.adminList));
router.get(
  "/organizations/:organizationId",
  requireAdmin,
  asyncRoute(controller.adminGet)
);
router.post(
  "/organizations/:organizationId/approve",
  requireAdmin,
  asyncRoute(controller.approve)
);
router.post(
  "/organizations/:organizationId/suspend",
  requireAdmin,
  asyncRoute(controller.suspend)
);
router.post(
  "/organizations/:organizationId/reinstate",
  requireAdmin,
  asyncRoute(controller.reinstate)
);
router.patch(
  "/organizations/:organizationId/members/:userId/status",
  requireAdmin,
  asyncRoute(controller.adminMemberStatus)
);
export default router;

import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./organizations.controller.js";

const router = Router();
router.patch(
  "/organizations/:organizationId/status",
  requireAdmin,
  asyncRoute(controller.adminChangeStatus)
);
export default router;

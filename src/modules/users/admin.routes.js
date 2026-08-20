import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./users.controller.js";

const router = Router();
router.get("/users", requireAdmin, asyncRoute(controller.list));
router.get("/users/:userId", requireAdmin, asyncRoute(controller.get));
router.patch(
  "/users/:userId/status",
  requireAdmin,
  asyncRoute(controller.status)
);
router.patch(
  "/users/:userId/roles",
  requireAdmin,
  asyncRoute(controller.roles)
);
export default router;

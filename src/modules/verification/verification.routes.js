import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./verification.controller.js";

const router = Router();
router.get("/verifications", requireAdmin, asyncRoute(controller.list));
router.get(
  "/verifications/:verificationId",
  requireAdmin,
  asyncRoute(controller.get)
);
router.patch(
  "/verifications/:verificationId",
  requireAdmin,
  asyncRoute(controller.update)
);
export default router;

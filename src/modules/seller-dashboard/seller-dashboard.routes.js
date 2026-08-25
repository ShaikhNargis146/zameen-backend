import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAnyRole, requireAuth } from "../auth/auth.routes.js";
import * as controller from "./seller-dashboard.controller.js";

const router = Router();
const requireSellerRole = requireAnyRole("SELLER", "BROKER", "DEVELOPER", "ADMIN");

router.get(
  "/seller/dashboard",
  requireAuth,
  requireSellerRole,
  asyncRoute(controller.summary)
);

export default router;

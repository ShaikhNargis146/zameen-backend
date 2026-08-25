import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth, optionalAuth } from "../auth/auth.routes.js";
import * as controller from "./recently-viewed.controller.js";

const router = Router();
router.post(
  "/recently-viewed/:listingId",
  optionalAuth,
  asyncRoute(controller.record)
);
router.get("/recently-viewed", requireAuth, asyncRoute(controller.list));

export default router;

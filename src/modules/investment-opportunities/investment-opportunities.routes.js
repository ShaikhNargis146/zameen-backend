import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { optionalAuth, requireAuth } from "../auth/auth.routes.js";
import * as controller from "./investment-opportunities.controller.js";

const router = Router();

router.get("/investment-opportunities", optionalAuth, asyncRoute(controller.list));
router.get("/investment-opportunities/:opportunityId", optionalAuth, asyncRoute(controller.detail));
router.post(
  "/investment-opportunities/:opportunityId/interest",
  requireAuth,
  asyncRoute(controller.createInterest)
);

export default router;

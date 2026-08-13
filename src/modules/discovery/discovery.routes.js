import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { optionalAuth } from "../auth/auth.routes.js";
import * as controller from "./discovery.controller.js";

const router = Router();
router.post("/search/listings", optionalAuth, asyncRoute(controller.search));
router.get("/search/suggestions", asyncRoute(controller.suggestions));
router.post("/search/map", optionalAuth, asyncRoute(controller.map));
router.get(
  "/listings/:listingId/similar",
  optionalAuth,
  asyncRoute(controller.similar)
);
router.post("/listings/compare", optionalAuth, asyncRoute(controller.compare));
export default router;

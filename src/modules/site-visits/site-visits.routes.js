import { Router } from "express";
import { requireOwnedResource } from "../../shared/authorization.js";
import { asyncRoute } from "../../shared/http.js";
import { requireAnyRole, requireAuth } from "../auth/auth.routes.js";
import * as controller from "./site-visits.controller.js";
import { ownedByParticipant, ownedBySeller } from "./site-visits.service.js";

const router = Router();
const requireSellerRole = requireAnyRole("SELLER", "BROKER", "DEVELOPER", "ADMIN");
const requireOwnedBySeller = requireOwnedResource({
  param: "visitId",
  target: "siteVisit",
  load: ownedBySeller
});
const requireOwnedByParticipant = requireOwnedResource({
  param: "visitId",
  target: "siteVisit",
  load: ownedByParticipant
});

router.post(
  "/listings/:listingId/site-visits",
  requireAuth,
  asyncRoute(controller.create)
);
router.get("/buyer/site-visits", requireAuth, asyncRoute(controller.buyerList));
router.get(
  "/seller/site-visits",
  requireAuth,
  requireSellerRole,
  asyncRoute(controller.sellerList)
);
router.post(
  "/site-visits/:visitId/confirm",
  requireAuth,
  requireSellerRole,
  requireOwnedBySeller,
  asyncRoute(controller.confirm)
);
router.post(
  "/site-visits/:visitId/reschedule",
  requireAuth,
  requireOwnedByParticipant,
  asyncRoute(controller.reschedule)
);
router.post(
  "/site-visits/:visitId/cancel",
  requireAuth,
  requireOwnedByParticipant,
  asyncRoute(controller.cancel)
);
router.post(
  "/site-visits/:visitId/complete",
  requireAuth,
  requireSellerRole,
  requireOwnedBySeller,
  asyncRoute(controller.complete)
);

export default router;

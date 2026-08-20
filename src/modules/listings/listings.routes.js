import { Router } from "express";
import { requireOwnedResource } from "../../shared/authorization.js";
import { asyncRoute } from "../../shared/http.js";
import {
  requireAdmin,
  requireAnyRole,
  requireAuth,
  optionalAuth
} from "../auth/auth.routes.js";
import * as controller from "./listings.controller.js";
import { listingForAdmin, ownedListing } from "./listings.service.js";

const router = Router();
const requirePropertyContributor = requireAnyRole(
  "SELLER",
  "BROKER",
  "DEVELOPER",
  "ADMIN"
);
const requireOwnedListing = requireOwnedResource({
  param: "listingId",
  target: "listing",
  load: ownedListing,
  loadForAdmin: listingForAdmin
});

router.post(
  "/properties/:propertyId/listings",
  requireAuth,
  requirePropertyContributor,
  asyncRoute(controller.create)
);
router.get(
  "/seller/listings",
  requireAuth,
  asyncRoute(controller.sellerListings)
);
router.get(
  "/listings/:listingId/detail",
  optionalAuth,
  asyncRoute(controller.detail)
);
router.get(
  "/listings/:listingId",
  requireAuth,
  requireOwnedListing,
  asyncRoute(controller.get)
);
router.patch(
  "/listings/:listingId",
  requireAuth,
  requireOwnedListing,
  asyncRoute(controller.update)
);
router.delete(
  "/listings/:listingId",
  requireAuth,
  requireOwnedListing,
  asyncRoute(controller.remove)
);
router.post(
  "/listings/:listingId/submit",
  requireAuth,
  requireOwnedListing,
  asyncRoute(controller.submit)
);
router.post(
  "/listings/:listingId/pause",
  requireAuth,
  requireOwnedListing,
  asyncRoute(controller.pause)
);
router.post(
  "/listings/:listingId/resume",
  requireAuth,
  requireOwnedListing,
  asyncRoute(controller.resume)
);
router.post(
  "/listings/:listingId/withdraw",
  requireAuth,
  requireOwnedListing,
  asyncRoute(controller.withdraw)
);
router.post(
  "/listings/:listingId/mark-sold",
  requireAuth,
  requireOwnedListing,
  asyncRoute(controller.markSold)
);
router.get(
  "/admin/listings",
  requireAdmin,
  asyncRoute(controller.adminListings)
);
router.get(
  "/admin/listings/:listingId",
  requireAdmin,
  asyncRoute(controller.adminListing)
);
router.post(
  "/admin/listings/:listingId/approve",
  requireAdmin,
  asyncRoute(controller.approve)
);
router.post(
  "/admin/listings/:listingId/reject",
  requireAdmin,
  asyncRoute(controller.reject)
);
router.post(
  "/admin/listings/:listingId/suspend",
  requireAdmin,
  asyncRoute(controller.suspend)
);
export default router;

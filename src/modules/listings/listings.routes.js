import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin, requireAuth } from "../auth/auth.routes.js";
import * as controller from "./listings.controller.js";
import { ownedListing } from "./listings.service.js";

const router = Router();
const requireOwnedListing = async (req, res, next) => {
  try {
    req.listing = await ownedListing(req.params.listingId, req.actor.id);
    return next();
  } catch (error) {
    return next(error);
  }
};

router.post(
  "/properties/:propertyId/listings",
  requireAuth,
  asyncRoute(controller.create)
);
router.get(
  "/seller/listings",
  requireAuth,
  asyncRoute(controller.sellerListings)
);
router.get("/listings/:listingId/detail", asyncRoute(controller.detail));
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

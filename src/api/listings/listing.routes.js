import { Router } from "express";
import authenticateToken from "../../middlewares/user_auth.js";
import ListingController from "./listing.controller.js";

const router = Router();

// Public routes (read-only)
router.get("/listings", authenticateToken, ListingController.getAllListings);
router.get("/listing-by-owner", authenticateToken, ListingController.getAllListingsByOwner);
router.get("/listing/:id", authenticateToken, ListingController.getListingById);
router.post(
  "/listing",
  authenticateToken,
  ListingController.createListing
);
router.post(
  "/listing/create-or-update",
  authenticateToken,
  ListingController.createAndUpdateListing
);
router.put(
  "/listing/:id",
  authenticateToken,
  ListingController.updateListing
);
router.delete(
  "/listing/:id",
  authenticateToken,
  ListingController.deleteListing
);
router.patch(
  "/listings/:id/status",
  authenticateToken,
  ListingController.updateByAdmin
);

export default router;

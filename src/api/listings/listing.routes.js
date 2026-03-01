import { Router } from "express";
import authenticateToken from "../../middlewares/authenticateToken.js";
import { requireRole } from "../../middlewares/requireRole.js";
import ListingController from "./listing.controller.js";

const router = Router();

// Public routes (read-only)
router.get("/listings", ListingController.getAllListings);
router.get("/listings/:id", ListingController.getListingById);
router.post(
  "/listings",
//   authenticateToken,
  ListingController.createListing
);
router.put(
  "/listings/:id",
  // authenticateToken,
  ListingController.updateListing
);
router.delete(
  "/listings/:id",
  // authenticateToken,
  ListingController.deleteListing
);
router.patch(
  "/listings/:id/status",
  // authenticateToken,
  ListingController.updateStatus
);

export default router;

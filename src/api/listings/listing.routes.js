import { Router } from "express";
import { userAuthenticateToken, adminAuthenticateToken} from "../../middlewares/auth_scope.js";
import ListingController from "./listing.controller.js";

const router = Router();

// Public routes (read-only)
router.get(
  "/listings",
  userAuthenticateToken,
  ListingController.getAllListings
);
router.get(
  "/listing-by-owner",
  userAuthenticateToken,
  ListingController.getAllListingsByOwner
);
router.get(
  "/listing/:id",
  userAuthenticateToken,
  ListingController.getListingById
);
router.post("/listing", 
  userAuthenticateToken, 
  ListingController.createListing);
  
router.post(
  "/listing/create-or-update",
  userAuthenticateToken,
  ListingController.createAndUpdateListing
);
router.put(
  "/listing-by-admin/:id",
  adminAuthenticateToken,
  ListingController.updateByAdmin
);
router.delete(
  "/listing/:id",
  userAuthenticateToken,
  ListingController.deleteListing
);
router.delete(
  "/listing-by-admin/:id",
  adminAuthenticateToken,
  ListingController.deleteByAdmin
);

export default router;

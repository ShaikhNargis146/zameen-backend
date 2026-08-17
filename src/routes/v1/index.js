import express from "express";

import authRoutes from "../../modules/auth/auth.routes.js";
import userRoutes from "../../modules/users/users.routes.js";
import adminUserRoutes from "../../modules/users/admin.routes.js";
import catalogRoutes from "../../modules/catalog/catalog.routes.js";
import propertyRoutes from "../../modules/properties/properties.routes.js";
import listingRoutesV1 from "../../modules/listings/listings.routes.js";
import organizationRoutes from "../../modules/organizations/organizations.routes.js";
import organizationAdminRoutes from "../../modules/organizations/organizations.admin.routes.js";
import favoritesRoutes from "../../modules/favorites/favorites.routes.js";
import recentlyViewedRoutes from "../../modules/recently-viewed/recently-viewed.routes.js";
import buyerRequirementsRoutes from "../../modules/buyer-requirements/buyer-requirements.routes.js";

const router = express.Router();

/**
 * GET v1/status
 */
router.get("/status", (req, res) => {
  res.json({
    message: "OK",
    timestamp: new Date().toISOString(),
    IP: req.ip,
    URL: req.originalUrl
  });
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/admin", adminUserRoutes);
router.use("/admin", organizationAdminRoutes);
router.use("/", propertyRoutes);
router.use("/", listingRoutesV1);
router.use("/", catalogRoutes);
router.use("/", organizationRoutes);
router.use("/", favoritesRoutes);
router.use("/", recentlyViewedRoutes);
router.use("/", buyerRequirementsRoutes);

export default router;

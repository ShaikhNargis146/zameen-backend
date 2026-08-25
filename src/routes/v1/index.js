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
import discoveryRoutes from "../../modules/discovery/discovery.routes.js";
import verificationRoutes from "../../modules/verification/verification.routes.js";
import aiRoutes from "../../modules/ai/ai.routes.js";
import enquiriesRoutes from "../../modules/enquiries/enquiries.routes.js";
import siteVisitsRoutes from "../../modules/site-visits/site-visits.routes.js";
import sellerDashboardRoutes from "../../modules/seller-dashboard/seller-dashboard.routes.js";
import commerceRoutes from "../../modules/commerce/commerce.routes.js";
import commerceAdminRoutes from "../../modules/commerce/commerce.admin.routes.js";
import contentRoutes from "../../modules/content/content.routes.js";
import contentAdminRoutes from "../../modules/content/content.admin.routes.js";
import channelPartnersRoutes from "../../modules/channel-partners/channel-partners.routes.js";
import channelPartnersAdminRoutes from "../../modules/channel-partners/channel-partners.admin.routes.js";
import investmentOpportunitiesRoutes from "../../modules/investment-opportunities/investment-opportunities.routes.js";
import investmentOpportunitiesAdminRoutes from "../../modules/investment-opportunities/investment-opportunities.admin.routes.js";
import auctionsRoutes from "../../modules/auctions/auctions.routes.js";
import auctionsAdminRoutes from "../../modules/auctions/auctions.admin.routes.js";
import adsRoutes from "../../modules/ads/ads.routes.js";
import adsAdminRoutes from "../../modules/ads/ads.admin.routes.js";
import notificationsRoutes from "../../modules/notifications/notifications.routes.js";

const router = express.Router();

/**
 * GET v1/status
 */
router.get("/status", (req, res) => {
  res.json({
    message: "OK",
    timestamp: new Date().toISOString()
  });
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/admin", adminUserRoutes);
router.use("/admin", organizationAdminRoutes);
router.use("/admin", verificationRoutes);
router.use("/admin", commerceAdminRoutes);
router.use("/admin", contentAdminRoutes);
router.use("/admin", channelPartnersAdminRoutes);
router.use("/admin", investmentOpportunitiesAdminRoutes);
router.use("/admin", auctionsAdminRoutes);
router.use("/admin", adsAdminRoutes);
router.use("/", propertyRoutes);
router.use("/", listingRoutesV1);
router.use("/", discoveryRoutes);
router.use("/", aiRoutes);
router.use("/", catalogRoutes);
router.use("/", organizationRoutes);
router.use("/", favoritesRoutes);
router.use("/", recentlyViewedRoutes);
router.use("/", buyerRequirementsRoutes);
router.use("/", enquiriesRoutes);
router.use("/", siteVisitsRoutes);
router.use("/", sellerDashboardRoutes);
router.use("/", commerceRoutes);
router.use("/", contentRoutes);
router.use("/", channelPartnersRoutes);
router.use("/", investmentOpportunitiesRoutes);
router.use("/", auctionsRoutes);
router.use("/", adsRoutes);
router.use("/", notificationsRoutes);

export default router;

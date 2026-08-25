import { Router } from "express";
import { requireOwnedResource } from "../../shared/authorization.js";
import { asyncRoute } from "../../shared/http.js";
import { requireAnyRole, requireAuth } from "../auth/auth.routes.js";
import * as controller from "./enquiries.controller.js";
import { ownedByBuyer, ownedBySeller } from "./enquiries.service.js";

const router = Router();
const requireSellerRole = requireAnyRole("SELLER", "BROKER", "DEVELOPER", "ADMIN");
const requireOwnedByBuyer = requireOwnedResource({
  param: "enquiryId",
  target: "enquiry",
  load: ownedByBuyer
});
const requireOwnedBySeller = requireOwnedResource({
  param: "enquiryId",
  target: "enquiry",
  load: ownedBySeller
});

router.post(
  "/listings/:listingId/enquiries",
  requireAuth,
  asyncRoute(controller.create)
);
router.get("/buyer/enquiries", requireAuth, asyncRoute(controller.buyerList));
router.get(
  "/buyer/enquiries/:enquiryId",
  requireAuth,
  requireOwnedByBuyer,
  asyncRoute(controller.buyerDetail)
);
router.get(
  "/seller/enquiries",
  requireAuth,
  requireSellerRole,
  asyncRoute(controller.sellerList)
);
router.get(
  "/seller/enquiries/:enquiryId",
  requireAuth,
  requireSellerRole,
  requireOwnedBySeller,
  asyncRoute(controller.sellerDetail)
);
router.patch(
  "/seller/enquiries/:enquiryId/status",
  requireAuth,
  requireSellerRole,
  requireOwnedBySeller,
  asyncRoute(controller.updateStatus)
);
router.post(
  "/seller/enquiries/:enquiryId/notes",
  requireAuth,
  requireSellerRole,
  requireOwnedBySeller,
  asyncRoute(controller.addNote)
);
router.post(
  "/listings/:listingId/contact-reveal",
  requireAuth,
  asyncRoute(controller.contactReveal)
);

export default router;

import { Router } from "express";
import { asyncRoute, fail } from "../../shared/http.js";
import { requireAuth } from "../auth/auth.routes.js";
import * as controller from "./properties.controller.js";
import { ownedProperty } from "./properties.service.js";

const router = Router();
const requirePropertyContributor = (req, res, next) =>
  req.actor.roles.some(role =>
    ["SELLER", "BROKER", "DEVELOPER", "ADMIN"].includes(role)
  )
    ? next()
    : fail(
        res,
        403,
        "PROPERTY_CREATION_FORBIDDEN",
        "Seller, broker, or developer access is required."
      );
const requireOwnedProperty = async (req, res, next) => {
  try {
    req.property = await ownedProperty(req.params.propertyId, req.actor.id);
    return next();
  } catch (error) {
    return next(error);
  }
};

router.post(
  "/properties",
  requireAuth,
  requirePropertyContributor,
  asyncRoute(controller.create)
);
router.get(
  "/properties/me",
  requireAuth,
  requirePropertyContributor,
  asyncRoute(controller.listMine)
);
router.get(
  "/properties/:propertyId",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.get)
);
router.patch(
  "/properties/:propertyId",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.update)
);
router.delete(
  "/properties/:propertyId",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.remove)
);
router.get(
  "/properties/:propertyId/land-details",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.landDetails)
);
router.put(
  "/properties/:propertyId/land-details",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.saveLandDetails)
);
router.get(
  "/properties/:propertyId/location",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.location)
);
router.put(
  "/properties/:propertyId/location",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.saveLocation)
);
router.get(
  "/properties/:propertyId/amenities",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.amenities)
);
router.put(
  "/properties/:propertyId/amenities",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.saveAmenities)
);
router.get(
  "/properties/:propertyId/parcel-identifiers",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.identifiers)
);
router.put(
  "/properties/:propertyId/parcel-identifiers",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.saveIdentifiers)
);
router.post(
  "/properties/:propertyId/verification/request",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.requestVerification)
);
router.get(
  "/properties/:propertyId/verification",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.verification)
);
router.get(
  "/properties/:propertyId/scanner",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.scanner)
);
router.get(
  "/properties/:propertyId/land-passport",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.passport)
);

export default router;

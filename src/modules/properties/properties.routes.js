import { Router } from "express";
import { requireOwnedResource } from "../../shared/authorization.js";
import { asyncRoute } from "../../shared/http.js";
import { requireUuidParam } from "../../shared/request-validation.js";
import {
  optionalAuth,
  requireAnyRole,
  requireAuth
} from "../auth/auth.routes.js";
import * as controller from "./properties.controller.js";
import {
  ownedProperty,
  propertyForAdmin,
  viewableProperty
} from "./properties.service.js";

const router = Router();
router.param("propertyId", requireUuidParam);
router.param("mediaId", requireUuidParam);
router.param("documentId", requireUuidParam);
router.param("grantId", requireUuidParam);
const requirePropertyContributor = requireAnyRole(
  "SELLER",
  "BROKER",
  "DEVELOPER",
  "ADMIN"
);
const requireOwnedProperty = requireOwnedResource({
  param: "propertyId",
  target: "property",
  load: ownedProperty,
  loadForAdmin: propertyForAdmin
});
const requireViewableProperty = requireOwnedResource({
  param: "propertyId",
  target: "property",
  load: viewableProperty,
  loadForAdmin: propertyForAdmin
});

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
  optionalAuth,
  requireViewableProperty,
  asyncRoute(controller.verification)
);
router.get(
  "/properties/:propertyId/scanner",
  optionalAuth,
  requireViewableProperty,
  asyncRoute(controller.scanner)
);
router.get(
  "/properties/:propertyId/land-passport",
  optionalAuth,
  requireViewableProperty,
  asyncRoute(controller.passport)
);
router.post(
  "/properties/:propertyId/media/upload-url",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.mediaUpload)
);
router.post(
  "/properties/:propertyId/media/complete",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.completeMedia)
);
router.get(
  "/properties/:propertyId/media",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.media)
);
router.patch(
  "/properties/:propertyId/media/:mediaId",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.updateMedia)
);
router.delete(
  "/properties/:propertyId/media/:mediaId",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.deleteMedia)
);
router.put(
  "/properties/:propertyId/media/order",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.orderMedia)
);
router.put(
  "/properties/:propertyId/media/:mediaId/cover",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.coverMedia)
);
router.post(
  "/properties/:propertyId/documents/upload-url",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.documentUpload)
);
router.post(
  "/properties/:propertyId/documents/complete",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.completeDocument)
);
router.get(
  "/properties/:propertyId/documents",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.documents)
);
router.get(
  "/properties/:propertyId/documents/:documentId",
  requireAuth,
  asyncRoute(controller.document)
);
router.get(
  "/properties/:propertyId/documents/:documentId/access-grants",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.documentAccessGrants)
);
router.post(
  "/properties/:propertyId/documents/:documentId/access-grants",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.grantDocumentAccess)
);
router.delete(
  "/properties/:propertyId/documents/:documentId/access-grants/:grantId",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.revokeDocumentAccess)
);
router.delete(
  "/properties/:propertyId/documents/:documentId",
  requireAuth,
  requireOwnedProperty,
  asyncRoute(controller.deleteDocument)
);

export default router;

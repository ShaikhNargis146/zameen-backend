import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth } from "../auth/auth.routes.js";
import * as controller from "./catalog.controller.js";
import { masters } from "./catalog.repository.js";

const router = Router();
for (const key of Object.keys(masters)) {
  if (key === "document-types")
    router.get(`/${key}`, requireAuth, asyncRoute(controller.documentTypes));
  else router.get(`/${key}`, asyncRoute(controller.master(key)));
}
router.get("/area-units", asyncRoute(controller.areaUnits));
router.get("/amenities", asyncRoute(controller.amenities));
router.get(
  "/parcel-config/:stateCode",
  requireAuth,
  asyncRoute(controller.parcelConfig)
);
router.get("/locations/search", asyncRoute(controller.searchLocations));
router.get(
  "/locations/pincode/:pincode",
  asyncRoute(controller.pincodeLocations)
);
router.get("/locations/states", asyncRoute(controller.states));
router.get(
  "/locations/states/:stateId/districts",
  asyncRoute(controller.children("DISTRICT"))
);
router.get(
  "/locations/districts/:districtId/cities",
  asyncRoute(controller.children("CITY"))
);
router.get(
  "/locations/cities/:cityId/localities",
  asyncRoute(controller.children("LOCALITY"))
);
router.get(
  "/locations/:locationId/children",
  asyncRoute(controller.children())
);
router.get("/locations/:locationId", asyncRoute(controller.location));
router.get("/geo/geocode", requireAuth, asyncRoute(controller.geocode));
router.get(
  "/geo/reverse-geocode",
  requireAuth,
  asyncRoute(controller.reverseGeocode)
);
export default router;

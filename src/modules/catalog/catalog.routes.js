import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import * as controller from "./catalog.controller.js";
import { masters } from "./catalog.repository.js";

const router = Router();
for (const key of Object.keys(masters))
  router.get(`/${key}`, asyncRoute(controller.master(key)));
router.get("/parcel-config/:stateCode", asyncRoute(controller.parcelConfig));
router.get("/locations/search", asyncRoute(controller.searchLocations));
router.get(
  "/locations/pincode/:pincode",
  asyncRoute(controller.pincodeLocations)
);
router.get("/locations/states", asyncRoute(controller.states));
router.get("/locations/:locationId/children", asyncRoute(controller.children));
router.get("/locations/:locationId", asyncRoute(controller.location));

export default router;

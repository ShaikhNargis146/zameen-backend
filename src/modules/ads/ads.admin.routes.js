import { Router } from "express";
import { requireOwnedResource } from "../../shared/authorization.js";
import { asyncRoute } from "../../shared/http.js";
import { requireUuidParam } from "../../shared/request-validation.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./ads.controller.js";
import { adForAdmin } from "./ads.service.js";

const router = Router();
router.param("adId", requireUuidParam);
router.param("mediaId", requireUuidParam);

// requireAdmin already guarantees the ADMIN role, so loadForAdmin always
// fires here — this just gates "does this ad exist", not ownership.
const requireAdExists = requireOwnedResource({
  param: "adId",
  target: "ad",
  load: adForAdmin,
  loadForAdmin: adForAdmin
});

router.get("/ads", requireAdmin, asyncRoute(controller.adminList));
router.get("/ads/:adId", requireAdmin, asyncRoute(controller.adminGet));
router.post("/ads", requireAdmin, asyncRoute(controller.create));
router.patch("/ads/:adId", requireAdmin, asyncRoute(controller.update));
router.delete("/ads/:adId", requireAdmin, asyncRoute(controller.remove));

router.post(
  "/ads/:adId/media/upload-url",
  requireAdmin,
  requireAdExists,
  asyncRoute(controller.mediaUploadUrl)
);
router.post(
  "/ads/:adId/media/complete",
  requireAdmin,
  requireAdExists,
  asyncRoute(controller.completeMediaUpload)
);
router.get("/ads/:adId/media", requireAdmin, requireAdExists, asyncRoute(controller.media));
router.patch(
  "/ads/:adId/media/:mediaId",
  requireAdmin,
  requireAdExists,
  asyncRoute(controller.updateMedia)
);
router.delete(
  "/ads/:adId/media/:mediaId",
  requireAdmin,
  requireAdExists,
  asyncRoute(controller.deleteMedia)
);
router.put("/ads/:adId/media/order", requireAdmin, requireAdExists, asyncRoute(controller.orderMedia));
router.put(
  "/ads/:adId/media/:mediaId/cover",
  requireAdmin,
  requireAdExists,
  asyncRoute(controller.coverMedia)
);

export default router;

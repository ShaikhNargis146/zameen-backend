import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./ads.controller.js";

const router = Router();

router.get("/ads", requireAdmin, asyncRoute(controller.adminList));
router.get("/ads/:adId", requireAdmin, asyncRoute(controller.adminGet));
router.post("/ads/media/upload-url", requireAdmin, asyncRoute(controller.mediaUploadUrl));
router.post("/ads/media/complete", requireAdmin, asyncRoute(controller.completeMediaUpload));
router.post("/ads", requireAdmin, asyncRoute(controller.create));
router.patch("/ads/:adId", requireAdmin, asyncRoute(controller.update));
router.delete("/ads/:adId", requireAdmin, asyncRoute(controller.remove));

export default router;

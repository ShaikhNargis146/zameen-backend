import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./content.controller.js";

const router = Router();

router.post("/content", requireAdmin, asyncRoute(controller.createContent));
router.patch("/content/:contentId", requireAdmin, asyncRoute(controller.updateContent));
router.delete("/content/:contentId", requireAdmin, asyncRoute(controller.deleteContent));
router.post("/content/:contentId/publish", requireAdmin, asyncRoute(controller.publishContent));
router.post("/content/:contentId/archive", requireAdmin, asyncRoute(controller.archiveContent));

router.post("/market-trends", requireAdmin, asyncRoute(controller.createSeries));
router.patch("/market-trends/:seriesId", requireAdmin, asyncRoute(controller.updateSeries));
router.delete("/market-trends/:seriesId", requireAdmin, asyncRoute(controller.deleteSeries));
router.post("/market-trends/:seriesId/points", requireAdmin, asyncRoute(controller.addPoint));
router.patch(
  "/market-trends/:seriesId/points/:pointId",
  requireAdmin,
  asyncRoute(controller.updatePoint)
);
router.delete(
  "/market-trends/:seriesId/points/:pointId",
  requireAdmin,
  asyncRoute(controller.deletePoint)
);

export default router;

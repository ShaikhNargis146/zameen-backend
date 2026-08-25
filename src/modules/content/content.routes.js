import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import * as controller from "./content.controller.js";

const router = Router();

router.get("/content", asyncRoute(controller.listContent));
router.get("/content/:slug", asyncRoute(controller.contentDetail));
router.get("/market-trends", asyncRoute(controller.marketTrends));

export default router;

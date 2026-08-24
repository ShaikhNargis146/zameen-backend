import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./channel-partners.controller.js";

const router = Router();

router.get("/channel-partners", requireAdmin, asyncRoute(controller.adminList));
router.get("/channel-partners/:partnerId", requireAdmin, asyncRoute(controller.adminGet));
router.post("/channel-partners/:partnerId/approve", requireAdmin, asyncRoute(controller.approve));
router.post("/channel-partners/:partnerId/reject", requireAdmin, asyncRoute(controller.reject));
router.post("/channel-partners/:partnerId/suspend", requireAdmin, asyncRoute(controller.suspend));

export default router;

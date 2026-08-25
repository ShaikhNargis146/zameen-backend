import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./investment-opportunities.controller.js";

const router = Router();

router.post("/investment-opportunities", requireAdmin, asyncRoute(controller.create));
router.patch("/investment-opportunities/:id", requireAdmin, asyncRoute(controller.update));
router.post("/investment-opportunities/:id/publish", requireAdmin, asyncRoute(controller.publish));
router.post("/investment-opportunities/:id/close", requireAdmin, asyncRoute(controller.close));

export default router;

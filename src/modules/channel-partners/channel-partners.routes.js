import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth } from "../auth/auth.routes.js";
import * as controller from "./channel-partners.controller.js";

const router = Router();

router.post("/channel-partners/apply", requireAuth, asyncRoute(controller.apply));
router.get("/channel-partners/me", requireAuth, asyncRoute(controller.me));
router.patch("/channel-partners/me", requireAuth, asyncRoute(controller.updateMe));

export default router;

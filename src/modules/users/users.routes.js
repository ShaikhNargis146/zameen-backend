import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth } from "../auth/auth.routes.js";
import * as controller from "./users.controller.js";

const router = Router();
router.get("/me", requireAuth, asyncRoute(controller.me));
router.patch("/me", requireAuth, asyncRoute(controller.updateMe));
router.get("/me/roles", requireAuth, asyncRoute(controller.myRoles));
router.post("/me/roles", requireAuth, asyncRoute(controller.addMyRole));
export default router;

import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./admin-dashboard.controller.js";

const router = Router();

router.get("/dashboard", requireAdmin, asyncRoute(controller.summary));

export default router;

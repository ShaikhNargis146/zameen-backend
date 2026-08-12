import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth } from "../auth/auth.routes.js";
import * as controller from "./favorites.controller.js";

const router = Router();
router.post("/favorites/:listingId", requireAuth, asyncRoute(controller.add));
router.delete("/favorites/:listingId", requireAuth, asyncRoute(controller.remove));
router.get("/favorites", requireAuth, asyncRoute(controller.list));

export default router;

import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./auctions.controller.js";

const router = Router();

router.post("/auctions", requireAdmin, asyncRoute(controller.create));
router.patch("/auctions/:auctionId", requireAdmin, asyncRoute(controller.update));
router.delete("/auctions/:auctionId", requireAdmin, asyncRoute(controller.remove));

export default router;

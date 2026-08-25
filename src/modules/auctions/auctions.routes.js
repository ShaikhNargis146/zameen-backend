import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import * as controller from "./auctions.controller.js";

const router = Router();

router.get("/auctions", asyncRoute(controller.list));
router.get("/auctions/:auctionId", asyncRoute(controller.detail));

export default router;

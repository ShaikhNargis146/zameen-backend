import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import * as controller from "./ads.controller.js";

const router = Router();

router.get("/ads", asyncRoute(controller.list));

export default router;

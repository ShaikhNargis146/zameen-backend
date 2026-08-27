import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import {
  optionalAuth,
  requireAnyRole,
  requireAuth
} from "../auth/auth.routes.js";
import * as controller from "./ai.controller.js";
import { aiRateLimit } from "../../config/rate-limit.config.js";

const router = Router();
router.use(aiRateLimit);
router.post("/ai/search", optionalAuth, asyncRoute(controller.search));
router.post(
  "/ai/conversations",
  requireAuth,
  asyncRoute(controller.createConversation)
);
router.get(
  "/ai/conversations",
  requireAuth,
  asyncRoute(controller.listConversations)
);
router.post(
  "/ai/conversations/:conversationId/messages",
  requireAuth,
  asyncRoute(controller.addMessage)
);
router.get(
  "/ai/conversations/:conversationId",
  requireAuth,
  asyncRoute(controller.getConversation)
);
router.post(
  "/ai/listing/generate",
  requireAuth,
  requireAnyRole("SELLER", "BROKER", "DEVELOPER", "ADMIN"),
  asyncRoute(controller.generateListing)
);
export default router;

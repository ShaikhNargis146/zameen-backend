import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import {
  optionalAuth,
  requireAnyRole,
  requireAuth
} from "../auth/auth.routes.js";
import * as controller from "./ai.controller.js";

const router = Router();
router.post("/ai/search", optionalAuth, asyncRoute(controller.search));
router.post(
  "/ai/conversations",
  optionalAuth,
  asyncRoute(controller.createConversation)
);
router.post(
  "/ai/conversations/:conversationId/messages",
  optionalAuth,
  asyncRoute(controller.addMessage)
);
router.get(
  "/ai/conversations/:conversationId",
  optionalAuth,
  asyncRoute(controller.getConversation)
);
router.post(
  "/ai/listing/generate",
  requireAuth,
  requireAnyRole("SELLER", "BROKER", "DEVELOPER", "ADMIN"),
  asyncRoute(controller.generateListing)
);
export default router;

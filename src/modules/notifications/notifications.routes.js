import { Router } from "express";
import { requireOwnedResource } from "../../shared/authorization.js";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth } from "../auth/auth.routes.js";
import * as controller from "./notifications.controller.js";
import { ownedByUser } from "./notifications.service.js";

const router = Router();
const requireOwnedNotification = requireOwnedResource({
  param: "notificationId",
  target: "notification",
  load: ownedByUser
});

router.get("/notifications", requireAuth, asyncRoute(controller.list));
router.patch(
  "/notifications/:notificationId/read",
  requireAuth,
  requireOwnedNotification,
  asyncRoute(controller.markRead)
);
router.post("/notifications/read-all", requireAuth, asyncRoute(controller.markAllRead));
router.get("/notification-preferences", requireAuth, asyncRoute(controller.getPreferences));
router.put("/notification-preferences", requireAuth, asyncRoute(controller.updatePreferences));

export default router;

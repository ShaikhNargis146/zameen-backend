import { Router } from "express";
import { asyncRoute } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import * as controller from "./commerce.controller.js";

const router = Router();

router.get("/plans", requireAdmin, asyncRoute(controller.adminPlans));
router.get("/plans/:planId", requireAdmin, asyncRoute(controller.adminGetPlan));
router.post("/plans", requireAdmin, asyncRoute(controller.createPlan));
router.patch("/plans/:planId", requireAdmin, asyncRoute(controller.updatePlan));
router.post("/plans/:planId/activate", requireAdmin, asyncRoute(controller.activatePlan));
router.post("/plans/:planId/deactivate", requireAdmin, asyncRoute(controller.deactivatePlan));

router.get("/service-requests", requireAdmin, asyncRoute(controller.adminServiceRequests));
router.get(
  "/service-requests/:requestId",
  requireAdmin,
  asyncRoute(controller.adminGetServiceRequest)
);
router.patch(
  "/service-requests/:requestId/status",
  requireAdmin,
  asyncRoute(controller.updateServiceRequestStatus)
);
router.post(
  "/service-requests/:requestId/report/upload-url",
  requireAdmin,
  asyncRoute(controller.serviceReportUploadUrl)
);
router.post(
  "/service-requests/:requestId/report",
  requireAdmin,
  asyncRoute(controller.submitServiceReport)
);

export default router;

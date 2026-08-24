import { Router } from "express";
import { requireOwnedResource } from "../../shared/authorization.js";
import { asyncRoute } from "../../shared/http.js";
import { requireAuth } from "../auth/auth.routes.js";
import * as controller from "./commerce.controller.js";
import { ownedServiceRequest } from "./commerce.service.js";

const router = Router();
const requireOwnedServiceRequest = requireOwnedResource({
  param: "requestId",
  target: "serviceRequest",
  load: ownedServiceRequest
});

router.get("/plans", asyncRoute(controller.plans));

router.post("/orders", requireAuth, asyncRoute(controller.createOrder));
router.get("/orders/me", requireAuth, asyncRoute(controller.myOrders));
router.get("/orders/:orderId", requireAuth, asyncRoute(controller.getOrder));

router.post(
  "/payments/:orderId/create",
  requireAuth,
  asyncRoute(controller.createPayment)
);
router.post("/payments/verify", requireAuth, asyncRoute(controller.verifyPayment));
router.post("/payments/webhook", asyncRoute(controller.webhook));

router.get("/services", asyncRoute(controller.services));
router.get("/services/:serviceId", asyncRoute(controller.getService));

router.post("/service-requests", requireAuth, asyncRoute(controller.createServiceRequest));
router.get("/service-requests/me", requireAuth, asyncRoute(controller.myServiceRequests));
router.get(
  "/service-requests/:requestId",
  requireAuth,
  asyncRoute(controller.getServiceRequest)
);
router.post(
  "/service-requests/:requestId/files/upload-url",
  requireAuth,
  requireOwnedServiceRequest,
  asyncRoute(controller.serviceRequestFileUpload)
);
router.post(
  "/service-requests/:requestId/files/complete",
  requireAuth,
  requireOwnedServiceRequest,
  asyncRoute(controller.completeServiceRequestFile)
);

export default router;

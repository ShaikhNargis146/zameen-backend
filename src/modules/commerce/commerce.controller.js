import { created, ok } from "../../shared/http.js";
import * as service from "./commerce.service.js";
import * as validation from "./commerce.validation.js";

export const plans = async (req, res) =>
  ok(res, await service.listPlans(validation.planAudience(req.query || {})));

export const createOrder = async (req, res) =>
  created(
    res,
    await service.createOrder({
      actorId: req.actor.id,
      input: validation.createOrder(req.body || {})
    })
  );

export const getOrder = async (req, res) =>
  ok(
    res,
    await service.orderForActor({
      orderId: validation.uuid(req.params.orderId, "orderId"),
      actor: req.actor
    })
  );

export const myOrders = async (req, res) => {
  const { data, meta } = await service.listMyOrders({
    actorId: req.actor.id,
    filters: validation.orderListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const createPayment = async (req, res) =>
  created(
    res,
    await service.createPaymentIntent({
      actorId: req.actor.id,
      orderId: validation.uuid(req.params.orderId, "orderId"),
      input: validation.createPayment(req.body || {})
    })
  );

export const verifyPayment = async (req, res) =>
  ok(
    res,
    await service.verifyPayment({
      actorId: req.actor.id,
      input: validation.verifyPayment(req.body || {})
    })
  );

export const webhook = async (req, res) =>
  ok(
    res,
    await service.handleWebhook({
      signatureHeader: req.headers["x-razorpay-signature"] || null,
      rawBody: req.rawBody || Buffer.from(JSON.stringify(req.body || {})),
      body: req.body || {}
    })
  );

export const createPlan = async (req, res) =>
  created(res, await service.createPlan(validation.createPlan(req.body || {})));

export const updatePlan = async (req, res) =>
  ok(
    res,
    await service.updatePlan({
      planId: validation.uuid(req.params.planId, "planId"),
      changes: validation.updatePlan(req.body || {})
    })
  );

export const activatePlan = async (req, res) =>
  ok(res, await service.setPlanActive(validation.uuid(req.params.planId, "planId"), true));

export const deactivatePlan = async (req, res) =>
  ok(res, await service.setPlanActive(validation.uuid(req.params.planId, "planId"), false));

export const services = async (req, res) =>
  ok(res, await service.listServices(validation.serviceListQuery(req.query || {}).serviceType));

export const getService = async (req, res) =>
  ok(res, await service.getService(validation.uuid(req.params.serviceId, "serviceId")));

export const createServiceRequest = async (req, res) =>
  created(
    res,
    await service.createServiceRequest({
      actorId: req.actor.id,
      input: validation.createServiceRequest(req.body || {})
    })
  );

export const myServiceRequests = async (req, res) => {
  const { data, meta } = await service.myServiceRequests({
    actorId: req.actor.id,
    filters: validation.serviceRequestListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const getServiceRequest = async (req, res) =>
  ok(
    res,
    await service.serviceRequestForActor({
      requestId: validation.uuid(req.params.requestId, "requestId"),
      actor: req.actor
    })
  );

export const serviceRequestFileUpload = async (req, res) =>
  ok(
    res,
    await service.createServiceRequestFileUpload({
      requestId: req.serviceRequest.id,
      input: validation.fileUploadInit(req.body || {})
    })
  );

export const completeServiceRequestFile = async (req, res) =>
  created(
    res,
    await service.completeServiceRequestFile({
      requestId: req.serviceRequest.id,
      actorId: req.actor.id,
      input: validation.serviceFileComplete(req.body || {})
    })
  );

export const adminServiceRequests = async (req, res) => {
  const { data, meta } = await service.listServiceRequestsAdmin({
    filters: validation.adminServiceRequestListQuery(req.query || {}),
    query: req.query
  });
  ok(res, data, meta);
};

export const adminGetServiceRequest = async (req, res) =>
  ok(
    res,
    await service.adminGetServiceRequest(validation.uuid(req.params.requestId, "requestId"))
  );

export const updateServiceRequestStatus = async (req, res) =>
  ok(
    res,
    await service.updateServiceRequestStatus({
      requestId: validation.uuid(req.params.requestId, "requestId"),
      changes: validation.updateServiceRequestStatus(req.body || {})
    })
  );

export const submitServiceReport = async (req, res) =>
  ok(
    res,
    await service.submitServiceReport({
      requestId: validation.uuid(req.params.requestId, "requestId"),
      input: validation.serviceReportInput(req.body || {})
    })
  );

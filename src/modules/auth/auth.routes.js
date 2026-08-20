import { Router } from "express";
import { asyncRoute, fail } from "../../shared/http.js";
import AuthService from "./auth.service.js";
import * as controller from "./auth.controller.js";

const bearer = req =>
  (req.headers.authorization || "").startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
export const requireAuth = async (req, res, next) => {
  const actor = await AuthService.authenticate(bearer(req));
  if (!actor)
    return fail(res, 401, "UNAUTHORIZED", "Authentication is required.");
  req.actor = actor;
  return next();
};
export const requireAnyRole = (...allowedRoles) => (req, res, next) => {
  if (req.actor?.roles?.some(role => allowedRoles.includes(role)))
    return next();
  return fail(
    res,
    403,
    "ROLE_REQUIRED",
    "You do not have permission to perform this action."
  );
};
export const requireAdmin = async (req, res, next) => {
  const actor = await AuthService.authenticate(bearer(req), {
    requireAdmin: true
  });
  if (!actor)
    return fail(
      res,
      403,
      "ADMIN_REQUIRED",
      "Administrator access is required."
    );
  req.actor = actor;
  return next();
};
export const optionalAuth = async (req, res, next) => {
  const token = bearer(req);
  req.actor = token ? await AuthService.authenticate(token) : null;
  return next();
};

const router = Router();
router.post("/otp/request", asyncRoute(controller.requestOtp));
router.post("/otp/verify", asyncRoute(controller.verifyOtp));
router.post("/refresh", asyncRoute(controller.refresh));
router.post("/logout", requireAuth, asyncRoute(controller.logout));
router.post("/logout-all", requireAuth, asyncRoute(controller.logoutAll));
export default router;

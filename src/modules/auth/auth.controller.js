import { created, fail, ok } from "../../shared/http.js";
import AuthService from "./auth.service.js";
import * as validation from "./auth.validation.js";

const respond = (res, result, success) =>
  result.ok
    ? success(res, result.data)
    : fail(res, result.status, result.code, result.message);
export const requestOtp = async (req, res) =>
  respond(
    res,
    await AuthService.requestOtp({
      ...validation.otpRequest(req.body || {}),
      ip: req.ip
    }),
    ok
  );
export const verifyOtp = async (req, res) =>
  respond(
    res,
    await AuthService.verifyOtp(
      validation.otpVerification(req.body || {}, req)
    ),
    created
  );
export const refresh = async (req, res) =>
  respond(
    res,
    await AuthService.refresh(validation.refresh(req.body || {}, req)),
    ok
  );
export const logout = async (req, res) => {
  await AuthService.logout(req.actor.sessionId);
  return ok(res, {});
};
export const logoutAll = async (req, res) => {
  await AuthService.logoutAll(req.actor.id);
  return ok(res, {});
};

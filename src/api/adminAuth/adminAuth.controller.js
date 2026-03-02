import httpStatus from "http-status";
import AdminAuthService from "./adminAuth.service.js";

const requestOtp = async (req, res, next) => {
  try {
    const phone = req.body?.phone;
    const response = await AdminAuthService.requestOtp({ phone, ip: req.ip });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const phone = req.body?.phone;
    const otp = req.body?.otp;
    const response = await AdminAuthService.verifyOtp({
      phone,
      otp,
      ip: req.ip,
      user_agent: req.headers["user-agent"] || null
    });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const me = async (req, res, next) => {
  try {
    const token = req.admin_token || null;
    const response = await AdminAuthService.me({ token });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const logout = async (req, res, next) => {
  try {
    const token = req.admin_token || null;
    const response = await AdminAuthService.logout({ token });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

export default { requestOtp, verifyOtp, me, logout };

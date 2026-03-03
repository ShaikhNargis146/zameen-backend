import httpStatus from "http-status";
import UserAuthService from "./userAuth.service.js";

const requestOtp = async (req, res, next) => {
  try {
    const phone = req.body?.phone;
    const response = await UserAuthService.requestOtp({ phone, ip: req.ip });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const verifyOtp = async (req, res, next) => {
  try {
    const phone = req.body?.phone;
    const otp = req.body?.otp;
    const name = req.body?.name || null;

    const response = await UserAuthService.verifyOtp({
      phone,
      otp,
      name,
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
    const token = req.user_token || null;
    const response = await UserAuthService.me({ token });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const actor = req.user || null;
    const response = await UserAuthService.updateProfile({
      actor,
      data: req.body || {}
    });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

const logout = async (req, res, next) => {
  try {
    const token = req.user_token || null;
    const response = await UserAuthService.logout({ token });
    return res.status(response.status || httpStatus.OK).json(response);
  } catch (e) {
    next(e);
  }
};

export default { requestOtp, verifyOtp, me, updateProfile, logout };

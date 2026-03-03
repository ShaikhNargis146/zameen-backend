import express from "express";
import controller from "./userAuth.controller.js";
import { userAuthenticateToken } from "../../middlewares/auth_scope.js";

const router = express.Router();
//app user login
router.route("/otp/request").post(controller.requestOtp);
router.route("/otp/verify").post(controller.verifyOtp);

router.route("/me").get(userAuthenticateToken, controller.me);
// PATCH /v1/user-auth/profile
// Body:
// - name: optional
// - email: optional (send null/empty string to clear)
// - role: optional, only self-change between user <-> agent is allowed
router.route("/profile").patch(userAuthenticateToken, controller.updateProfile);
router.route("/logout").post(userAuthenticateToken, controller.logout);

export default router;

import express from "express";
import controller from "./adminAuth.controller.js";
import adminAuthenticateToken from "../../middlewares/admin_auth.js";

const router = express.Router();
// admin login
router.route("/otp/request").post(controller.requestOtp);
router.route("/otp/verify").post(controller.verifyOtp);

router.route("/me").get(adminAuthenticateToken, controller.me);
router.route("/logout").post(adminAuthenticateToken, controller.logout);

export default router;

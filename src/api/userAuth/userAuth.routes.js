import express from "express";
import controller from "./userAuth.controller.js";
import userAuthenticateToken from "../../middlewares/user_auth.js";

const router = express.Router();
//app user login
router.route("/otp/request").post(controller.requestOtp);
router.route("/otp/verify").post(controller.verifyOtp);

router.route("/me").get(userAuthenticateToken, controller.me);
router.route("/logout").post(userAuthenticateToken, controller.logout);

export default router;

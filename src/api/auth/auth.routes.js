import { Router } from "express";
import AuthController from "./auth.controller.js";
import authenticateToken from "../../middlewares/authenticateToken.js";

const router = Router();

router.post("/request-otp", AuthController.requestOtp);
router.post("/login", AuthController.login);
router.get("/me", authenticateToken, AuthController.me);

export default router;

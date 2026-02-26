import { Router } from "express";
import authenticateToken from "../../middlewares/authenticateToken.js";
import { requireRole } from "../../middlewares/requireRole.js";
import AdminUsersController from "./adminUsers.controller.js";

const router = Router();

router.post(
  "/users/admin",
  authenticateToken,
  requireRole("admin"),
  AdminUsersController.createAdmin
);

export default router;

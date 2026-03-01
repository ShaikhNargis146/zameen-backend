import express from "express";
import controller from "./appUsers.controller.js";
import adminAuthenticateToken from "../../middlewares/admin_auth.js";

const router = express.Router();
//manage app accounts from admin panel
router.route("/").get(adminAuthenticateToken, controller.listAppUsers);
router.route("/").post(adminAuthenticateToken, controller.createAppUser);
router
  .route("/:id")
  .patch(adminAuthenticateToken, controller.patchAppUserStatus);

export default router;

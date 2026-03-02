import express from "express";
import controller from "./adminUsers.controller.js";
import adminAuthenticateToken from "../../middlewares/admin_auth.js";

const router = express.Router();

// admin can list, but only super_admin can create/block/unblock (enforced in service) manage admin accounts
router.route("/").get(adminAuthenticateToken, controller.listAdmins);
router.route("/").post(adminAuthenticateToken, controller.createAdmin);
router.route("/:id").patch(adminAuthenticateToken, controller.patchAdminStatus);
router.route("/summary").get(adminAuthenticateToken, controller.summary);

export default router;

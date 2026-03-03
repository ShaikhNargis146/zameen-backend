import express from "express";
import controller from "./users.controller.js";
import { adminAuthenticateToken } from "../../middlewares/auth_scope.js";

const router = express.Router();

// GET /v1/users
// Query params:
// - scope: "admin" | "app" (default: "app")
// - limit, offset
// - search: matches name/phone/email
// - role: filtered within the selected scope
// - status: active|inactive|blocked
// - org_id: only for scope=app
router.route("/").get(adminAuthenticateToken, controller.listUsers);

// POST /v1/users
// Body:
// - scope: "admin" | "app" (default: "app")
// - name: required
// - phone: required
// - email: optional
// - role: required for non-default role
//   admin scope -> admin|super_admin
//   app scope -> user|agent|org_admin|org_member
// - status: active|inactive|blocked (optional, default: active)
// - org_id: required for app scope when role is org_admin/org_member
router.route("/").post(adminAuthenticateToken, controller.createUser);

// PATCH /v1/users/:id
// Body:
// - scope: "admin" | "app" (default: "app")
// - status: active|inactive|blocked
router.route("/:id").patch(adminAuthenticateToken, controller.patchUserStatus);

// GET /v1/users/summary
// Returns admin/app user, org, listing, inquiry, and ad counts for dashboard cards.
router.route("/summary").get(adminAuthenticateToken, controller.summary);

export default router;

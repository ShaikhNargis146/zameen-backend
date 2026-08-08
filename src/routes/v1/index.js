import express from "express";

import authRoutes from "../../modules/auth/auth.routes.js";
import userRoutes from "../../modules/users/users.routes.js";
import adminUserRoutes from "../../modules/users/admin.routes.js";
import catalogRoutes from "../../modules/catalog/catalog.routes.js";

const router = express.Router();

/**
 * GET v1/status
 */
router.get("/status", (req, res) => {
  res.json({
    message: "OK",
    timestamp: new Date().toISOString(),
    IP: req.ip,
    URL: req.originalUrl
  });
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/admin", adminUserRoutes);
router.use("/", catalogRoutes);

export default router;

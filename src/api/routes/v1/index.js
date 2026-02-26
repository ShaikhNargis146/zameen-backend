import express from "express";

// import all the routes here
import adminUsersRoutes from "../../adminUsers/adminUsers.routes.js";
import authRoutes from "../../auth/auth.routes.js";

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

router.use("/admin", adminUsersRoutes);
router.use("/auth", authRoutes);

export default router;

import express from "express";

// import all the routes here
import adminAuthRoutes from "../../adminAuth/adminAuth.routes.js";
import usersRoutes from "../../users/users.routes.js";
import userAuthRoutes from "../../userAuth/userAuth.routes.js";
import listingRoutes from "../../listings/listing.routes.js";

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

router.use("/admin-auth", adminAuthRoutes);
router.use("/users", usersRoutes);
router.use("/user-auth", userAuthRoutes);
router.use("/property", listingRoutes);

export default router;

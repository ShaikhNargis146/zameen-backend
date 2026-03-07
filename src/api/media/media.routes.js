import { Router } from "express";
import MediaController from "./media.controller.js";
import { uploadSingle, uploadMulti } from "../../middlewares/upload_multer.js";
import { userAuthenticateToken, adminAuthenticateToken } from "../../middlewares/auth_scope.js";

const router = Router();

// Error handler for multer
const multerErrorHandler = (err, req, res, next) => {
  if (err && err.message && err.message.includes("Invalid file type")) {
    return res.status(400).json({ message: err.message });
  }
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ message: "File size exceeds 50MB limit" });
  }
  if (err && err.code === "LIMIT_FILE_COUNT") {
    return res.status(400).json({ message: "Too many files uploaded" });
  }
  next(err);
};


router.post(
  "/upload-single/:listingId",
  userAuthenticateToken,
  uploadSingle("file"),
  multerErrorHandler,
  MediaController.uploadSingle
);

router.post(
  "/upload-multiple/:listingId",
  userAuthenticateToken,
  uploadMulti("files", 20),
  multerErrorHandler,
  MediaController.uploadMultiple
);

// Get media endpoints - allow any authenticated user (no public access)
router.get(
  "/listing/:listingId",
  userAuthenticateToken,
  MediaController.getListingMedia
);

router.get(
  "/:mediaId",
  userAuthenticateToken,
  MediaController.getMediaById
);

// Get media endpoints - allow any authenticated user (no public access)
router.get(
  "/listing-admin/:listingId",
  adminAuthenticateToken,
  MediaController.getListingMedia
);

router.get(
  "/admin/:mediaId",
  adminAuthenticateToken,
  MediaController.getMediaById
);

export default router;

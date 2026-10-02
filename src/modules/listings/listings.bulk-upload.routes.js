import { Router } from "express";
import multer from "multer";
import { asyncRoute, HttpError } from "../../shared/http.js";
import { requireAdmin } from "../auth/auth.routes.js";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  UPLOAD_MIME_TYPES
} from "./listings.bulk-upload.constants.js";
import * as controller from "./listings.bulk-upload.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES },
  fileFilter: (req, file, callback) => {
    // The extension is the reliable signal here — browsers/OS report wildly
    // inconsistent mimetypes for .csv, so mimetype is only a fallback check.
    const hasCsvExtension = /\.csv$/i.test(file.originalname || "");
    if (!hasCsvExtension && !UPLOAD_MIME_TYPES.has(file.mimetype))
      return callback(
        new HttpError(400, "INVALID_FILE_TYPE", "Only .csv files are accepted.")
      );
    return callback(null, true);
  }
});
// multer reports errors through its own callback rather than throwing, so
// they must be funnelled into next(err) manually to reach the standard
// {success:false,error} envelope instead of an unhandled/opaque 500.
const uploadSingleFile = (req, res, next) =>
  upload.single("file")(req, res, error => {
    if (!error) return next();
    if (error instanceof HttpError) return next(error);
    if (error.code === "LIMIT_FILE_SIZE")
      return next(
        new HttpError(
          400,
          "FILE_TOO_LARGE",
          `The uploaded file exceeds the maximum size of ${MAX_UPLOAD_FILE_SIZE_BYTES /
            (1024 * 1024)}MB.`
        )
      );
    return next(
      new HttpError(400, "INVALID_FILE", "The uploaded file could not be processed.")
    );
  });

const router = Router();

router.get(
  "/admin/listings/bulk-upload/template",
  requireAdmin,
  asyncRoute(controller.template)
);
router.post(
  "/admin/listings/bulk-upload",
  requireAdmin,
  uploadSingleFile,
  asyncRoute(controller.upload)
);

export default router;

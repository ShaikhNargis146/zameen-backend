import multer from "multer";

const storage = multer.memoryStorage();

// Allowed MIME types for images and videos
const ALLOWED_MIME_TYPES = {
  // Images
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/svg+xml": [".svg"],
  // Videos
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
  "video/x-msvideo": [".avi"],
  "video/x-matroska": [".mkv"],
  "video/webm": [".webm"],
  "video/mpeg": [".mpeg", ".mpg"],
  "video/ogg": [".ogv"],
  "video/3gpp": [".3gp"]
};

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    const allowedTypes = Object.keys(ALLOWED_MIME_TYPES).join(", ");
    return cb(
      new Error(`Invalid file type. Allowed types: ${allowedTypes}`),
      false
    );
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

export const uploadSingle = (fieldName = "file") => upload.single(fieldName);
export const uploadMulti = (fieldName = "files", maxCount = 20) =>
  upload.array(fieldName, maxCount);

import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

export const uploadSingle = (fieldName = "file") => upload.single(fieldName);
export const uploadMulti = (fieldName = "files", maxCount = 10) =>
  upload.array(fieldName, maxCount);

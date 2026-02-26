import multer from "multer";

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === "text/csv" ||
      file.originalname.toLowerCase().endsWith(".csv");
    cb(ok ? null : new Error("Only CSV files are allowed"), ok);
  }
});

export default upload;

import multer from "multer";
import { Storage } from "@google-cloud/storage";
// import pLimit from "p-limit";
import path from "path";

// ---------- Storage client (Local + Prod) ----------
// If GOOGLE_APPLICATION_CREDENTIALS is set to a JSON file path, GCP SDK will pick it up automatically.
// In prod (Cloud Run/GKE/CE), ADC uses the attached service account.
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || "karma-law"
});

const bucketName = process.env.GOOGLE_CLOUD_BUCKET || "karma-admin";
const bucket = storage.bucket(bucketName);

// ---------- Multer ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 } // 150MB max
});

// ---------- Helpers ----------
function safeFileName(originalName) {
  const ext = path.extname(originalName || "").toLowerCase();
  const base = path
    .basename(originalName || "file", ext)
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  return `${base || "file"}${ext || ""}`;
}

async function generateSignedUrl(objectName, ttlMs = 60 * 60 * 1000) {
  const [url] = await bucket.file(objectName).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + ttlMs
  });
  return url;
}

async function uploadToGCS(file, folder, filename) {
  if (!file) throw new Error("No file provided");

  const cleanName =
    filename || `${Date.now()}-${safeFileName(file.originalname)}`;
  const objectName = folder
    ? `${folder.replace(/\/+$/g, "")}/${cleanName}`
    : cleanName;

  const blob = bucket.file(objectName);

  await new Promise((resolve, reject) => {
    const stream = blob.createWriteStream({
      resumable: true, // better for large files
      contentType: file.mimetype,
      metadata: {
        cacheControl: "private, max-age=0"
      }
    });

    stream.on("finish", resolve);
    stream.on("error", reject);
    stream.end(file.buffer);
  });

  // return stable reference + signed url (optional)
  const signedUrl = await generateSignedUrl(objectName);

  return {
    bucket: bucketName,
    object: objectName,
    gsUri: `gs://${bucketName}/${objectName}`,
    signedUrl
  };
}

async function uploadMultipleToGCS(files, folder, concurrency = 3) {
  if (!files?.length) return [];

  // With memoryStorage, keep concurrency low or you WILL OOM with large files.
  // const limit = pLimit(concurrency);

  // return Promise.all(
  //   files.map(file =>
  //     limit(async () => {
  //       const filename = `${Date.now()}-${safeFileName(file.originalname)}`;
  //       try {
  //         const result = await uploadToGCS(file, folder, filename);
  //         return { file: filename, status: "success", ...result };
  //       } catch (error) {
  //         return { file: filename, status: "failed", error: error.message };
  //       }
  //     })
  //   )
  // );
}

async function deleteFiles(objectNames) {
  if (!objectNames?.length) {
    return { success: false, message: "No files provided for deletion" };
  }

  try {
    await Promise.all(objectNames.map(name => bucket.file(name).delete()));
    return { success: true, message: "Files deleted successfully" };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default {
  upload,
  uploadToGCS,
  uploadMultipleToGCS,
  generateSignedUrl,
  deleteFiles
};

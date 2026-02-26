import { Storage } from "@google-cloud/storage";
import path from "path";
import crypto from "crypto";

const storage = new Storage({
  retryOptions: {
    autoRetry: true,
    maxRetries: 5,
    retryDelayMultiplier: 2,
    totalTimeout: 120, // seconds
    maxRetryDelay: 10, // seconds
    idempotencyStrategy: 1 // RetryAlways
  }
});
const BUCKET = process.env.GCS_BUCKET;
if (!BUCKET) throw new Error("GCS_BUCKET env is required");

function cleanFileName(originalName) {
  const base = path.basename(originalName || "file.pdf");
  return base
    .replace(/\s+/g, "_")
    .replace(/[^\w.\-()]+/g, "_")
    .slice(0, 180);
}

function sha256Hex(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

export async function uploadBufferToGCS({
  bucketName = process.env.GCS_BUCKET,
  buffer,
  contentType = "application/pdf",
  originalName = "document.pdf",
  instrument_version_id
}) {
  if (!buffer?.length) throw new Error("EMPTY_BUFFER");
  if (!bucketName) throw new Error("GCS_BUCKET_MISSING");

  const sha256 = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
  const ext = path.extname(originalName) || ".pdf";
  const base = path.basename(originalName, ext).replace(/[^\w.-]/g, "_");

  const objectPath = `floora/source_docs/${instrument_version_id}/${base}_${sha256.slice(
    0,
    12
  )}${ext}`;

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectPath);

  console.error("[GCS] uploadBufferToGCS using file.save", {
    node: process.version,
    bucketName,
    hasBuffer: !!buffer?.length,
    size: buffer?.length
  });
  try {
    await file.save(buffer, {
      resumable: true, // switch ON (see below)
      validation: "crc32c",
      contentType,
      metadata: {
        metadata: {
          originalName,
          sha256,
          instrument_version_id: String(instrument_version_id)
        }
      }
    });
  } catch (e) {
    // IMPORTANT: console.error only (no custom logger)
    console.error("[GCS] file.save threw:", e);
    throw e;
  }

  return { bucket: bucketName, objectPath, sha256 };
}

export async function getSignedReadUrl({
  bucket,
  objectPath,
  expiresInMinutes = 15
}) {
  if (!bucket) throw new Error("bucket is required");
  if (!objectPath) throw new Error("objectPath is required");

  const file = storage.bucket(bucket).file(objectPath);

  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInMinutes * 60 * 1000,
    // optional but nice:
    responseType: "application/pdf"
  });

  return url;
}

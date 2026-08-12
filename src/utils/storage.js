import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";
import path from "node:path";
import { HttpError } from "../shared/http.js";

const bucketName = process.env.GCS_BUCKET || null;
const storage = new Storage();
const safeName = value =>
  path
    .basename(String(value || "file"))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
const ensureStorage = () => {
  if (!bucketName)
    throw new HttpError(
      503,
      "STORAGE_UNCONFIGURED",
      "File storage is not configured."
    );
  return storage.bucket(bucketName);
};

export const createStorageKey = ({ propertyId, category, fileName }) =>
  `properties/${propertyId}/${category}/${randomUUID()}-${safeName(fileName)}`;
export const belongsToProperty = ({ propertyId, category, storageKey }) =>
  String(storageKey || "").startsWith(`properties/${propertyId}/${category}/`);
export const signedWriteUrl = async ({ storageKey, mimeType }) => {
  const [uploadUrl] = await ensureStorage()
    .file(storageKey)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 15 * 60 * 1000,
      contentType: mimeType
    });
  return {
    uploadUrl,
    storageKey,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    requiredHeaders: { "Content-Type": mimeType }
  };
};
export const signedReadUrl = async storageKey => {
  if (!storageKey) return null;
  const [url] = await ensureStorage()
    .file(storageKey)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 15 * 60 * 1000
    });
  return url;
};

import { Storage } from "@google-cloud/storage";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { HttpError } from "../shared/http.js";
import logger from "./logger.js";

const bucketName = process.env.GCS_BUCKET || null;
const storage = new Storage();
const safeDiagnosticValue = value => {
  if (value === undefined || value === null || value === "") return "none";
  return String(value)
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .slice(0, 100);
};
// Storage SDK errors can carry request data. Log only provider diagnostics, never
// an error body, signed URL, object key, or credentials.
export const storageErrorMetadata = error => ({
  name: safeDiagnosticValue(error?.name),
  code: safeDiagnosticValue(error?.code),
  status: Number.isInteger(error?.code) ? error.code : "none"
});
export const storageUnavailable = error => {
  if (error instanceof HttpError) return error;
  const diagnostic = storageErrorMetadata(error);
  logger.warn(
    "Cloud Storage signed URL request failed " +
      `[name=${diagnostic.name}, code=${diagnostic.code}, status=${diagnostic.status}]`
  );
  return new HttpError(
    503,
    "STORAGE_UNAVAILABLE",
    "File storage is temporarily unavailable."
  );
};
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
export const createServiceRequestStorageKey = ({ requestId, fileName }) =>
  `service-requests/${requestId}/files/${randomUUID()}-${safeName(fileName)}`;
export const belongsToServiceRequest = ({ requestId, storageKey }) =>
  String(storageKey || "").startsWith(`service-requests/${requestId}/files/`);
export const signedWriteUrl = async ({ storageKey, mimeType }) => {
  try {
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
  } catch (error) {
    throw storageUnavailable(error);
  }
};
export const signedReadUrl = async storageKey => {
  // Public listing discovery must continue to work when media storage has not
  // been provisioned (for example on a fresh developer environment).
  if (!storageKey || !bucketName) return null;
  try {
    const [url] = await ensureStorage()
      .file(storageKey)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 15 * 60 * 1000
      });
    return url;
  } catch (error) {
    throw storageUnavailable(error);
  }
};

// Discovery and listing-card media are optional presentation data. A transient
// signing failure must not make otherwise valid listings disappear from a page.
export const optionalSignedReadUrl = async storageKey => {
  try {
    return await signedReadUrl(storageKey);
  } catch (error) {
    if (["STORAGE_UNCONFIGURED", "STORAGE_UNAVAILABLE"].includes(error?.code))
      return null;
    throw error;
  }
};

import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toField = code =>
  /^[A-Z0-9_]+$/.test(code) ? code.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()) : code;

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text)) {
    const message = `${field} must be a valid UUID.`;
    throw new HttpError(400, "INVALID_ID", message, [{ field: toField(field), message }]);
  }
  return text;
};

const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max) {
    const message = `${field} must be at most ${max} characters.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return text;
};

const optionalBoolean = (value, defaultValue, field) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  const message = `${field} must be a boolean.`;
  throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
};

const requiredBoolean = (value, field) => {
  if (typeof value === "boolean") return value;
  const message = `${field} must be a boolean.`;
  throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
};

export const notificationListQuery = query => ({
  unreadOnly: optionalBoolean(query.unreadOnly, false, "UNREAD_ONLY"),
  type: optionalString(query.type, 50, "TYPE")
});

export const notificationPreferencesInput = body => ({
  emailEnabled: requiredBoolean(body.emailEnabled, "EMAIL_ENABLED"),
  smsEnabled: requiredBoolean(body.smsEnabled, "SMS_ENABLED"),
  whatsappEnabled: requiredBoolean(body.whatsappEnabled, "WHATSAPP_ENABLED"),
  marketingEnabled: requiredBoolean(body.marketingEnabled, "MARKETING_ENABLED")
});

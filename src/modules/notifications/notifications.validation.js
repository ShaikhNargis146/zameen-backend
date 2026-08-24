import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};

const optionalString = (value, max, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (text.length > max)
    throw new HttpError(400, `INVALID_${field}`, `${field} must be at most ${max} characters.`);
  return text;
};

const optionalBoolean = (value, defaultValue, field) => {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  throw new HttpError(400, `INVALID_${field}`, `${field} must be a boolean.`);
};

const requiredBoolean = (value, field) => {
  if (typeof value === "boolean") return value;
  throw new HttpError(400, `INVALID_${field}`, `${field} must be a boolean.`);
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

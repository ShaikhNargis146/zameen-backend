import { HttpError } from "../../shared/http.js";

const channels = new Set(["SMS", "EMAIL"]);
const purposes = new Set(["LOGIN", "REGISTER", "VERIFY_PHONE", "VERIFY_EMAIL"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optionalDeviceValue = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const result = String(value).trim();
  if (result.length > 255)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must be at most 255 characters.`
    );
  return result;
};

export const otpRequest = body => {
  const destination = String(body.destination || "").trim();
  const channel = String(body.channel || "").toUpperCase();
  if (!channels.has(channel))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "channel must be SMS or EMAIL."
    );
  if (!destination)
    throw new HttpError(400, "VALIDATION_ERROR", "destination is required.");
  const purpose = String(body.purpose || "").toUpperCase();
  if (!purposes.has(purpose))
    throw new HttpError(400, "VALIDATION_ERROR", "purpose is invalid.");
  const phone =
    channel === "SMS" && body.countryCode && !destination.startsWith("+")
      ? `${body.countryCode}${destination}`
      : destination;
  if (channel === "SMS" && !/^\+?\d{10,15}$/.test(phone.replace(/\s/g, "")))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "destination must be a valid phone number."
    );
  if (channel === "EMAIL" && !emailPattern.test(destination))
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "destination must be a valid email address."
    );
  return {
    phone: channel === "SMS" ? phone : undefined,
    email: channel === "EMAIL" ? destination : undefined,
    purpose
  };
};
export const otpVerification = (body, request) => ({
  challengeId: body.challengeId,
  otp: body.otp,
  deviceId: optionalDeviceValue(body.deviceId, "deviceId"),
  deviceName: optionalDeviceValue(body.deviceName, "deviceName"),
  ip: request.ip,
  userAgent: request.headers["user-agent"] || null
});
export const refresh = (body, request) => ({
  refreshToken: body.refreshToken,
  deviceId: optionalDeviceValue(body.deviceId, "deviceId"),
  deviceName: optionalDeviceValue(body.deviceName, "deviceName"),
  ip: request.ip,
  userAgent: request.headers["user-agent"] || null
});

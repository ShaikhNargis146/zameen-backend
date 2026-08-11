export const otpRequest = body => {
  const destination = String(body.destination || "").trim();
  const channel = String(body.channel || "").toUpperCase();
  const phone =
    channel === "SMS" && body.countryCode && !destination.startsWith("+")
      ? `${body.countryCode}${destination}`
      : destination;
  return {
    phone: channel === "SMS" ? phone : undefined,
    email: channel === "EMAIL" ? destination : undefined,
    purpose: body.purpose || "LOGIN"
  };
};
export const otpVerification = (body, request) => ({
  challengeId: body.challengeId,
  otp: body.otp,
  deviceId: body.deviceId || null,
  deviceName: body.deviceName || null,
  ip: request.ip,
  userAgent: request.headers["user-agent"] || null
});
export const refresh = (body, request) => ({
  refreshToken: body.refreshToken,
  deviceId: body.deviceId || null,
  deviceName: body.deviceName || null,
  ip: request.ip,
  userAgent: request.headers["user-agent"] || null
});

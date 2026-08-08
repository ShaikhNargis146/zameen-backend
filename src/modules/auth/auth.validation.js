export const otpRequest = body => ({
  phone: body.phone,
  email: body.email,
  purpose: body.purpose || "LOGIN"
});
export const otpVerification = (body, request) => ({
  ...otpRequest(body),
  otp: body.otp,
  name: body.name,
  ip: request.ip,
  userAgent: request.headers["user-agent"] || null
});
export const refresh = (body, request) => ({
  refreshToken: body.refreshToken,
  ip: request.ip,
  userAgent: request.headers["user-agent"] || null
});

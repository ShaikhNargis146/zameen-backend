import { HttpError } from "../../shared/http.js";
import logger from "../../utils/logger.js";

const mode = String(process.env.OTP_DELIVERY_MODE || "").toLowerCase();
const webhookUrl = process.env.OTP_PROVIDER_WEBHOOK_URL || null;
const nonProduction = process.env.NODE_ENV !== "production";

export const otpDeliveryConfigured = () =>
  (mode === "console" && nonProduction) ||
  (mode === "webhook" && Boolean(webhookUrl));

export const deliverOtp = async ({ destination, channel, purpose, code }) => {
  if (!otpDeliveryConfigured())
    throw new HttpError(
      503,
      "OTP_PROVIDER_UNCONFIGURED",
      "OTP service is unavailable."
    );

  // Console delivery is deliberately opt-in and is never available in production.
  if (mode === "console") {
    logger.info(`Development OTP for ${channel} ${destination}: ${code}`);
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination, channel, purpose, code }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  } catch (error) {
    logger.error(`OTP delivery failed: ${error.message}`);
    throw new HttpError(
      503,
      "OTP_DELIVERY_FAILED",
      "OTP service is temporarily unavailable."
    );
  }
};

import { HttpError } from "../../../shared/http.js";
import { hmacSha256Hex, safeEqualHex } from "../../../utils/crypto.js";

const API_BASE = "https://api.razorpay.com/v1";

const authHeader = (keyId, keySecret) =>
  `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

// Razorpay's REST surface used here (payment links, refunds, payment lookup)
// is small enough that a thin fetch-based adapter avoids adding the `razorpay`
// SDK as a new dependency — see docs/razorpay-integration-plan.md section 6.1.
const request = async ({ method, path, keyId, keySecret, body, timeoutMs }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: authHeader(keyId, keySecret),
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError")
      throw new HttpError(
        502,
        "PAYMENT_PROVIDER_TIMEOUT",
        "The payment provider did not respond in time."
      );
    throw new HttpError(
      502,
      "PAYMENT_PROVIDER_UNAVAILABLE",
      "The payment provider could not be reached."
    );
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new HttpError(
      502,
      "PAYMENT_PROVIDER_ERROR",
      payload?.error?.description || "The payment provider rejected the request."
    );
  return payload;
};

export const createPaymentLink = ({
  keyId,
  keySecret,
  timeoutMs,
  amountMinor,
  currency,
  referenceId,
  description,
  callbackUrl,
  notes
}) =>
  request({
    method: "POST",
    path: "/payment_links",
    keyId,
    keySecret,
    timeoutMs,
    body: {
      amount: amountMinor,
      currency,
      reference_id: referenceId,
      description,
      callback_url: callbackUrl,
      callback_method: "get",
      notes: notes || {}
    }
  }).then(payload => ({
    id: payload.id,
    shortUrl: payload.short_url,
    status: payload.status,
    raw: payload
  }));

// Confirm this field order/format against the current Razorpay Payment Links
// API reference before relying on it in production — see
// docs/razorpay-integration-plan.md section 19.
export const verifyPaymentLinkCallbackSignature = ({ query, keySecret }) => {
  const paymentId = query?.razorpay_payment_id;
  const linkId = query?.razorpay_payment_link_id;
  const referenceId = query?.razorpay_payment_link_reference_id;
  const status = query?.razorpay_payment_link_status;
  const signature = query?.razorpay_signature;
  if (!paymentId || !linkId || !referenceId || !status || !signature) return false;
  const payload = `${linkId}|${referenceId}|${status}|${paymentId}`;
  return safeEqualHex(signature, hmacSha256Hex(payload, keySecret));
};

export const verifyWebhookSignature = ({ rawBody, signature, secret }) => {
  if (!signature) return false;
  return safeEqualHex(signature, hmacSha256Hex(rawBody, secret));
};

export const fetchPayment = ({ keyId, keySecret, timeoutMs, providerPaymentId }) =>
  request({
    method: "GET",
    path: `/payments/${providerPaymentId}`,
    keyId,
    keySecret,
    timeoutMs
  });

export const createRefund = ({ keyId, keySecret, timeoutMs, providerPaymentId, amountMinor, notes }) =>
  request({
    method: "POST",
    path: `/payments/${providerPaymentId}/refund`,
    keyId,
    keySecret,
    timeoutMs,
    body: { amount: amountMinor, notes: notes || {} }
  }).then(payload => ({ id: payload.id, status: payload.status, raw: payload }));

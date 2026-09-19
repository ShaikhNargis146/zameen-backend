import assert from "node:assert/strict";
import test from "node:test";

import { hmacSha256Hex } from "../../src/utils/crypto.js";
import {
  verifyPaymentLinkCallbackSignature,
  verifyWebhookSignature
} from "../../src/modules/commerce/providers/razorpay.provider.js";

const keySecret = "test-key-secret";

test("payment link callback signature accepts a correctly signed query", () => {
  const linkId = "plink_123";
  const referenceId = "ZMN-O-ABC123";
  const status = "paid";
  const paymentId = "pay_456";
  const signature = hmacSha256Hex(`${linkId}|${referenceId}|${status}|${paymentId}`, keySecret);

  assert.equal(
    verifyPaymentLinkCallbackSignature({
      query: {
        razorpay_payment_id: paymentId,
        razorpay_payment_link_id: linkId,
        razorpay_payment_link_reference_id: referenceId,
        razorpay_payment_link_status: status,
        razorpay_signature: signature
      },
      keySecret
    }),
    true
  );
});

test("payment link callback signature rejects a tampered status", () => {
  const linkId = "plink_123";
  const referenceId = "ZMN-O-ABC123";
  const paymentId = "pay_456";
  const signature = hmacSha256Hex(`${linkId}|${referenceId}|paid|${paymentId}`, keySecret);

  assert.equal(
    verifyPaymentLinkCallbackSignature({
      query: {
        razorpay_payment_id: paymentId,
        razorpay_payment_link_id: linkId,
        razorpay_payment_link_reference_id: referenceId,
        razorpay_payment_link_status: "cancelled",
        razorpay_signature: signature
      },
      keySecret
    }),
    false
  );
});

test("payment link callback signature rejects an incomplete query", () => {
  assert.equal(
    verifyPaymentLinkCallbackSignature({
      query: { razorpay_payment_id: "pay_456" },
      keySecret
    }),
    false
  );
});

test("payment link callback signature rejects a signature signed with the wrong secret", () => {
  const linkId = "plink_123";
  const referenceId = "ZMN-O-ABC123";
  const status = "paid";
  const paymentId = "pay_456";
  const signature = hmacSha256Hex(`${linkId}|${referenceId}|${status}|${paymentId}`, "wrong-secret");

  assert.equal(
    verifyPaymentLinkCallbackSignature({
      query: {
        razorpay_payment_id: paymentId,
        razorpay_payment_link_id: linkId,
        razorpay_payment_link_reference_id: referenceId,
        razorpay_payment_link_status: status,
        razorpay_signature: signature
      },
      keySecret
    }),
    false
  );
});

test("webhook signature accepts a correctly signed raw body", () => {
  const rawBody = Buffer.from(JSON.stringify({ event: "payment.captured" }));
  const signature = hmacSha256Hex(rawBody, keySecret);
  assert.equal(verifyWebhookSignature({ rawBody, signature, secret: keySecret }), true);
});

test("webhook signature rejects a body that does not match the signature", () => {
  const signature = hmacSha256Hex(Buffer.from("{}"), keySecret);
  const tamperedBody = Buffer.from(JSON.stringify({ event: "payment.captured", amount: 999999 }));
  assert.equal(verifyWebhookSignature({ rawBody: tamperedBody, signature, secret: keySecret }), false);
});

test("webhook signature rejects a missing signature header", () => {
  const rawBody = Buffer.from("{}");
  assert.equal(verifyWebhookSignature({ rawBody, signature: null, secret: keySecret }), false);
});

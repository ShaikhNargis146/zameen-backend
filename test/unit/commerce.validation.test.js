import assert from "node:assert/strict";
import test from "node:test";

import * as validation from "../../src/modules/commerce/commerce.validation.js";
import { computePlanEndsAt } from "../../src/modules/commerce/commerce.repository.js";
import { paymentMatchesProvider } from "../../src/modules/commerce/commerce.service.js";

const productId = "11111111-1111-1111-1111-111111111111";
const listingId = "22222222-2222-2222-2222-222222222222";

test("createOrder accepts a PLAN item with no target", () => {
  const result = validation.createOrder({ items: [{ productId }] });
  assert.deepEqual(result.items[0], {
    productId,
    quantity: 1,
    targetType: null,
    targetId: null
  });
});

test("createOrder accepts a PROMOTION item targeting a listing", () => {
  const result = validation.createOrder({
    items: [{ productId, targetType: "LISTING", targetId: listingId }]
  });
  assert.equal(result.items[0].targetType, "LISTING");
  assert.equal(result.items[0].targetId, listingId);
});

test("createOrder rejects a free-text targetType", () => {
  assert.throws(
    () => validation.createOrder({ items: [{ productId, targetType: "ANYTHING", targetId: listingId }] }),
    error => error.code === "INVALID_ITEMS_0_TARGET_TYPE"
  );
});

test("createOrder rejects a targetId without a targetType", () => {
  assert.throws(
    () => validation.createOrder({ items: [{ productId, targetId: listingId }] }),
    error => error.code === "TARGET_TYPE_REQUIRED"
  );
});

test("createOrder rejects a targetType without a targetId", () => {
  assert.throws(
    () => validation.createOrder({ items: [{ productId, targetType: "LISTING" }] }),
    error => error.code === "TARGET_ID_REQUIRED"
  );
});

test("createPayment no longer accepts a returnUrl (redirect target is fixed by the server)", () => {
  assert.deepEqual(validation.createPayment({ returnUrl: "https://evil.example" }), {
    provider: "RAZORPAY"
  });
});

test("paymentCallbackQuery reads Razorpay's redirect query params by name", () => {
  const result = validation.paymentCallbackQuery({
    razorpay_payment_id: "pay_1",
    razorpay_payment_link_id: "plink_1",
    razorpay_payment_link_reference_id: "ZMN-O-1",
    razorpay_payment_link_status: "paid",
    razorpay_signature: "abc123"
  });
  assert.deepEqual(result, {
    paymentId: "pay_1",
    paymentLinkId: "plink_1",
    referenceId: "ZMN-O-1",
    status: "paid",
    signature: "abc123"
  });
});

test("plan entitlement extension starts from now when there is no existing active plan", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const endsAt = computePlanEndsAt({ existingEndsAt: null, durationDays: 30, now });
  assert.equal(endsAt.toISOString(), "2026-01-31T00:00:00.000Z");
});

test("plan entitlement extension stacks onto a still-active plan's remaining time", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const existingEndsAt = new Date("2026-01-10T00:00:00.000Z");
  const endsAt = computePlanEndsAt({ existingEndsAt, durationDays: 30, now });
  assert.equal(endsAt.toISOString(), "2026-02-09T00:00:00.000Z");
});

test("plan entitlement extension does not backdate from an already-expired plan", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const existingEndsAt = new Date("2025-06-01T00:00:00.000Z");
  const endsAt = computePlanEndsAt({ existingEndsAt, durationDays: 30, now });
  assert.equal(endsAt.toISOString(), "2026-01-31T00:00:00.000Z");
});

test("plan entitlement extension returns null for a plan with no fixed duration", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(computePlanEndsAt({ existingEndsAt: null, durationDays: null, now }), null);
});

const payment = { amountMinor: 99900, currency: "INR" };

test("payment matches provider when amount, currency, and status all agree", () => {
  assert.equal(
    paymentMatchesProvider({
      payment,
      providerAmountMinor: 99900,
      providerCurrency: "INR",
      providerStatus: "captured"
    }),
    true
  );
});

test("payment does not match provider when the amount differs", () => {
  assert.equal(
    paymentMatchesProvider({
      payment,
      providerAmountMinor: 1,
      providerCurrency: "INR",
      providerStatus: "captured"
    }),
    false
  );
});

test("payment does not match provider when the currency differs", () => {
  assert.equal(
    paymentMatchesProvider({
      payment,
      providerAmountMinor: 99900,
      providerCurrency: "USD",
      providerStatus: "captured"
    }),
    false
  );
});

test("payment does not match provider when the currency case differs", () => {
  assert.equal(
    paymentMatchesProvider({
      payment,
      providerAmountMinor: 99900,
      providerCurrency: "inr",
      providerStatus: "captured"
    }),
    true
  );
});

test("payment does not match provider when it is not yet captured", () => {
  assert.equal(
    paymentMatchesProvider({
      payment,
      providerAmountMinor: 99900,
      providerCurrency: "INR",
      providerStatus: "authorized"
    }),
    false
  );
});

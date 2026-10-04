import assert from "node:assert/strict";
import test from "node:test";

import { reconciliationDecision } from "../../src/modules/commerce/commerce.service.js";

const payment = { id: "11111111-1111-4111-8111-111111111111" };
const paidLink = {
  id: "plink_1",
  status: "paid",
  reference_id: payment.id,
  payments: [{ payment_id: "pay_1", amount: 99900, status: "captured" }]
};

test("a paid link with a captured payment is captured using that payment id", () => {
  assert.deepEqual(reconciliationDecision({ payment, link: paidLink }), {
    action: "capture",
    providerPaymentId: "pay_1"
  });
});

test("a paid link whose payments array has no captured entry is skipped", () => {
  const link = { ...paidLink, payments: [{ payment_id: "pay_1", status: "failed" }] };
  assert.equal(reconciliationDecision({ payment, link }).action, "skip");
});

test("a link whose reference_id is not this payment is never captured", () => {
  const link = { ...paidLink, reference_id: "22222222-2222-4222-8222-222222222222" };
  assert.deepEqual(reconciliationDecision({ payment, link }), {
    action: "skip",
    reason: "reference_mismatch"
  });
});

test("a missing link response is skipped, never captured", () => {
  assert.equal(reconciliationDecision({ payment, link: null }).action, "skip");
});

test("an expired or cancelled link fails the payment", () => {
  for (const status of ["expired", "cancelled"]) {
    assert.deepEqual(
      reconciliationDecision({ payment, link: { ...paidLink, status, payments: [] } }),
      { action: "fail", reason: status }
    );
  }
});

test("created and partially_paid links are left waiting", () => {
  for (const status of ["created", "partially_paid"]) {
    assert.deepEqual(
      reconciliationDecision({ payment, link: { ...paidLink, status, payments: [] } }),
      { action: "wait", reason: status }
    );
  }
});

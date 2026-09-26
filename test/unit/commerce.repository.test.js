import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import {
  resolveEffectivePlanForOwner,
  resolveEffectivePlanForUser
} from "../../src/modules/commerce/commerce.repository.js";

const withStub = async (stub, callback) => {
  const original = pg.oneOrNone;
  pg.oneOrNone = stub;
  try {
    await callback();
  } finally {
    pg.oneOrNone = original;
  }
};

// resolveEffectivePlanForUser/ForOwner are what every entitlement check
// (limits, quota, features, GET /me/subscription) reads a plan through.
// They must fall back to the LIVE, admin-editable PLAN_FREE catalog row --
// not a hardcoded JS constant -- whenever there's no currently-active
// plan_subscriptions row, whether that's because the owner never purchased
// anything, or because they purchased once and it has since lapsed with
// nothing newer. See docs/subscription-entitlements-audit-checklist.md §D1
// for the bug this closes.

test("resolveEffectivePlanForUser returns the real active row unchanged when one exists — never touches the PLAN_FREE fallback query", async () => {
  const calls = [];
  await withStub(async (query, params) => {
    calls.push(query);
    assert.match(query, /ps\.user_id = \$1 AND ps\.organization_id IS NULL/);
    return { ok: true, data: { listingLimit: 20, code: "PLAN_PRO" } };
  }, async () => {
    const plan = await resolveEffectivePlanForUser("user-1");
    assert.equal(plan.code, "PLAN_PRO");
  });
  assert.equal(calls.length, 1);
});

test("resolveEffectivePlanForUser falls back to the live PLAN_FREE catalog row when the user has no active plan row at all", async () => {
  const calls = [];
  await withStub(async query => {
    calls.push(query);
    if (/ps\.user_id = \$1 AND ps\.organization_id IS NULL/.test(query)) return { ok: true, data: null };
    assert.match(query, /pr\.code = 'PLAN_FREE'/);
    return { ok: true, data: { id: "plan-free-1", code: "PLAN_FREE", listingLimit: 2 } };
  }, async () => {
    const plan = await resolveEffectivePlanForUser("user-1");
    assert.equal(plan.code, "PLAN_FREE");
    assert.equal(plan.listingLimit, 2);
    assert.equal(plan.subscriptionStatus, "ACTIVE");
    assert.equal(plan.startsAt, null);
    assert.equal(plan.endsAt, null);
  });
  assert.equal(calls.length, 2);
});

test("resolveEffectivePlanForUser returns null (not throwing) if PLAN_FREE itself isn't seeded, so the caller's own DEFAULT_FREE_* constant is the last resort", async () => {
  await withStub(async () => ({ ok: true, data: null }), async () => {
    const plan = await resolveEffectivePlanForUser("user-1");
    assert.equal(plan, null);
  });
});

test("resolveEffectivePlanForOwner applies the same PLAN_FREE fallback for an organization that has never purchased or has let its plan lapse", async () => {
  const calls = [];
  await withStub(async query => {
    calls.push(query);
    if (/ps\.organization_id = \$1/.test(query)) return { ok: true, data: null };
    assert.match(query, /pr\.code = 'PLAN_FREE'/);
    return { ok: true, data: { id: "plan-free-1", code: "PLAN_FREE", listingLimit: 2 } };
  }, async () => {
    const plan = await resolveEffectivePlanForOwner({ userId: "user-1", organizationId: "org-1" });
    assert.equal(plan.code, "PLAN_FREE");
  });
  assert.equal(calls.length, 2);
});

test("resolveEffectivePlanForOwner returns the org's real active row unchanged when one exists", async () => {
  await withStub(async query => {
    assert.match(query, /ps\.organization_id = \$1/);
    return { ok: true, data: { listingLimit: null, code: "PLAN_BUSINESS" } };
  }, async () => {
    const plan = await resolveEffectivePlanForOwner({ userId: "user-1", organizationId: "org-1" });
    assert.equal(plan.code, "PLAN_BUSINESS");
  });
});

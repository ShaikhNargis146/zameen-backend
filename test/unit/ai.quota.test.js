import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import {
  DEFAULT_FREE_AI_MONTHLY_QUOTA,
  hasAiQuotaRemaining
} from "../../src/modules/ai/ai.service.js";
import * as aiRepository from "../../src/modules/ai/ai.repository.js";

test("a plan with no quota configured (null) is unlimited", () => {
  assert.equal(hasAiQuotaRemaining({ quota: null, usedThisMonth: 999999 }), true);
});

test("usage strictly below quota still has room", () => {
  assert.equal(hasAiQuotaRemaining({ quota: 5, usedThisMonth: 4 }), true);
});

test("usage at quota has no room left", () => {
  assert.equal(hasAiQuotaRemaining({ quota: 5, usedThisMonth: 5 }), false);
});

test("usage past quota has no room left", () => {
  assert.equal(hasAiQuotaRemaining({ quota: 5, usedThisMonth: 6 }), false);
});

test("the ambient Free tier (no active plan_subscription row) defaults to 5/month", () => {
  assert.equal(DEFAULT_FREE_AI_MONTHLY_QUOTA, 5);
});

const withStub = async (method, stub, callback) => {
  const original = pg[method];
  pg[method] = stub;
  try {
    await callback();
  } finally {
    pg[method] = original;
  }
};

test("active plan lookup is scoped to the user and excludes expired/inactive rows", async () => {
  await withStub(
    "oneOrNone",
    async (query, params) => {
      assert.match(query, /FROM commerce\.plan_subscriptions ps/);
      assert.match(query, /JOIN commerce\.plans pl ON pl\.id = ps\.plan_id/);
      assert.match(query, /ps\.user_id = \$1/);
      assert.match(query, /ps\.status = 'ACTIVE'/);
      assert.match(query, /ps\.ends_at IS NULL OR ps\.ends_at > now\(\)/);
      assert.deepEqual(params, ["user-1"]);
      return { ok: true, data: { aiMonthlyQuota: 50 } };
    },
    async () => {
      const plan = await aiRepository.activePlanForUser("user-1");
      assert.equal(plan.aiMonthlyQuota, 50);
    }
  );
});

test("active plan lookup excludes organization-scoped plans — a plan bought for an org must not grant the buyer personal AI quota", async () => {
  await withStub(
    "oneOrNone",
    async query => {
      assert.match(query, /ps\.organization_id IS NULL/);
      return { ok: true, data: { aiMonthlyQuota: 50 } };
    },
    async () => {
      await aiRepository.activePlanForUser("user-1");
    }
  );
});

test("monthly assistant-message count only counts answered questions from this calendar month", async () => {
  await withStub(
    "one",
    async (query, params) => {
      assert.match(query, /FROM ai\.messages m/);
      assert.match(query, /JOIN ai\.conversations c ON c\.id = m\.conversation_id/);
      assert.match(query, /c\.user_id = \$1/);
      assert.match(query, /m\.role = 'ASSISTANT'/);
      assert.match(query, /m\.created_at >= date_trunc\('month', now\(\)\)/);
      assert.deepEqual(params, ["user-1"]);
      return { ok: true, data: { count: 3 } };
    },
    async () => {
      const count = await aiRepository.assistantMessageCountThisMonth("user-1");
      assert.equal(count, 3);
    }
  );
});

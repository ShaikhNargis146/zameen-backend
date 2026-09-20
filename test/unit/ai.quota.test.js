import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { DEFAULT_FREE_AI_MONTHLY_QUOTA } from "../../src/modules/ai/ai.service.js";
import * as aiRepository from "../../src/modules/ai/ai.repository.js";

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

// pg.tx hands the callback a transaction object (t) with its own
// one/none/... methods — reserveAiQuotaUsage runs the advisory lock, the
// usage count, and the insert all through that one object.
const withTxStub = async (t, callback) => {
  const original = pg.tx;
  pg.tx = async fn => {
    try {
      const data = await fn(t);
      return { ok: true, data, error: null };
    } catch (error) {
      return { ok: false, data: null, error };
    }
  };
  try {
    await callback();
  } finally {
    pg.tx = original;
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

test("reserving a quota slot takes a per-user advisory lock before counting usage, so concurrent callers serialize", async () => {
  const calls = [];
  const t = {
    none: async (query, params) => {
      calls.push(["none", query, params]);
      assert.match(query, /pg_advisory_xact_lock\(hashtext\(\$1::text\)\)/);
      assert.deepEqual(params, ["user-1"]);
    },
    one: async (query, params) => {
      calls.push(["one", query, params]);
      if (/SELECT count\(\*\)/.test(query)) {
        assert.match(query, /FROM ai\.usage_events/);
        assert.match(query, /reserved_at >= date_trunc\('month', now\(\)\)/);
        assert.match(query, /confirmed_at IS NOT NULL OR reserved_at > now\(\) - interval '5 minutes'/);
        assert.deepEqual(params, ["user-1"]);
        return { used: 2 };
      }
      assert.match(query, /INSERT INTO ai\.usage_events \(user_id, kind\)/);
      assert.deepEqual(params, ["user-1", "CHAT"]);
      return { id: "reservation-1" };
    }
  };
  await withTxStub(t, async () => {
    const id = await aiRepository.reserveAiQuotaUsage("user-1", 5, "CHAT");
    assert.equal(id, "reservation-1");
  });
  // The lock is taken before the usage is ever counted.
  assert.equal(calls[0][0], "none");
  assert.equal(calls[1][0], "one");
});

test("reserving a quota slot at the cap returns null and never inserts a row", async () => {
  const t = {
    none: async () => {},
    one: async query => {
      if (/SELECT count\(\*\)/.test(query)) return { used: 5 };
      throw new Error("must not insert once quota is exhausted");
    }
  };
  await withTxStub(t, async () => {
    const id = await aiRepository.reserveAiQuotaUsage("user-1", 5, "CHAT");
    assert.equal(id, null);
  });
});

test("confirming a reservation marks it permanent for the rest of the month", async () => {
  await withStub(
    "none",
    async (query, params) => {
      assert.match(query, /UPDATE ai\.usage_events SET confirmed_at = now\(\)/);
      assert.deepEqual(params, ["reservation-1"]);
      return { ok: true, data: null };
    },
    async () => {
      await aiRepository.confirmAiQuotaUsage("reservation-1");
    }
  );
});

test("releasing a reservation deletes it, so a failed/aborted attempt never costs quota", async () => {
  await withStub(
    "none",
    async (query, params) => {
      assert.match(query, /DELETE FROM ai\.usage_events WHERE id = \$1/);
      assert.deepEqual(params, ["reservation-1"]);
      return { ok: true, data: null };
    },
    async () => {
      await aiRepository.releaseAiQuotaUsage("reservation-1");
    }
  );
});

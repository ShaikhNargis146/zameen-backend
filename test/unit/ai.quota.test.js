import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { DEFAULT_FREE_AI_MONTHLY_QUOTA, search } from "../../src/modules/ai/ai.service.js";
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

test("organization plan lookup is scoped to an APPROVED channel partner's own organization and its active plan", async () => {
  await withStub(
    "oneOrNone",
    async (query, params) => {
      assert.match(query, /FROM account\.channel_partner_profiles cp/);
      assert.match(query, /JOIN commerce\.plan_subscriptions ps ON ps\.organization_id = cp\.organization_id/);
      assert.match(query, /cp\.user_id = \$1/);
      assert.match(query, /cp\.status = 'APPROVED'/);
      assert.match(query, /ps\.status = 'ACTIVE'/);
      assert.deepEqual(params, ["user-1"]);
      return { ok: true, data: { aiMonthlyQuota: 200, organizationId: "org-1" } };
    },
    async () => {
      const plan = await aiRepository.activeOrganizationPlanForChannelPartner("user-1");
      assert.equal(plan.aiMonthlyQuota, 200);
      assert.equal(plan.organizationId, "org-1");
    }
  );
});

test("reserving a personal quota slot takes a per-user advisory lock, counts only that user's non-org usage, and inserts with organization_id null", async () => {
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
        assert.match(query, /user_id = \$1 AND organization_id IS NULL/);
        assert.match(query, /reserved_at >= date_trunc\('month', now\(\)\)/);
        assert.match(query, /confirmed_at IS NOT NULL OR reserved_at > now\(\) - interval '5 minutes'/);
        assert.deepEqual(params, ["user-1"]);
        return { used: 2 };
      }
      assert.match(query, /INSERT INTO ai\.usage_events \(user_id, organization_id, kind\)/);
      assert.deepEqual(params, ["user-1", null, "CHAT"]);
      return { id: "reservation-1" };
    }
  };
  await withTxStub(t, async () => {
    const id = await aiRepository.reserveAiQuotaUsage({
      userId: "user-1",
      organizationId: null,
      quota: 5,
      kind: "CHAT"
    });
    assert.equal(id, "reservation-1");
  });
  // The lock is taken before the usage is ever counted.
  assert.equal(calls[0][0], "none");
  assert.equal(calls[1][0], "one");
});

test("reserving an org quota slot locks on the organization, counts every member's usage against it, and inserts with the user still attributed", async () => {
  const t = {
    none: async (query, params) => {
      assert.match(query, /pg_advisory_xact_lock\(hashtext\(\$1::text\)\)/);
      assert.deepEqual(params, ["org-1"]);
    },
    one: async (query, params) => {
      if (/SELECT count\(\*\)/.test(query)) {
        assert.match(query, /organization_id = \$1/);
        assert.doesNotMatch(query, /user_id = \$1/);
        assert.deepEqual(params, ["org-1"]);
        return { used: 3 };
      }
      assert.match(query, /INSERT INTO ai\.usage_events \(user_id, organization_id, kind\)/);
      assert.deepEqual(params, ["user-1", "org-1", "CHAT"]);
      return { id: "reservation-2" };
    }
  };
  await withTxStub(t, async () => {
    const id = await aiRepository.reserveAiQuotaUsage({
      userId: "user-1",
      organizationId: "org-1",
      quota: 10,
      kind: "CHAT"
    });
    assert.equal(id, "reservation-2");
  });
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
    const id = await aiRepository.reserveAiQuotaUsage({
      userId: "user-1",
      organizationId: null,
      quota: 5,
      kind: "CHAT"
    });
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

// ---------------------------------------------------------------------------
// Org-vs-personal precedence, exercised end to end through ai.service.js's
// exported search() (the real reserveAiQuota orchestration is a private
// function, so this is the only way to cover it without a mocking library —
// see the repo's existing convention of stubbing pg directly). Every case
// here is driven to throw or to fail on a stubbed step *before*
// provider.searchIntent would ever run, so none of them make a real OpenAI
// call.
// ---------------------------------------------------------------------------

const withPgStubs = async (stubs, callback) => {
  const originals = {};
  for (const key of Object.keys(stubs)) {
    originals[key] = pg[key];
    pg[key] = stubs[key];
  }
  try {
    await callback();
  } finally {
    for (const key of Object.keys(originals)) pg[key] = originals[key];
  }
};

// Routes the two distinct oneOrNone lookups reserveAiQuota can issue
// (activeOrganizationPlanForChannelPartner, then activePlanForUser only if
// that came back empty) to canned responses, while recording how many times
// each was actually queried.
const planLookupStub = ({ orgPlan = null, personalPlan = null, calls }) => async (query, params) => {
  if (/account\.channel_partner_profiles/.test(query)) {
    calls.org.push(params);
    return { ok: true, data: orgPlan };
  }
  if (/commerce\.plan_subscriptions/.test(query)) {
    calls.personal.push(params);
    return { ok: true, data: personalPlan };
  }
  throw new Error(`Unexpected oneOrNone query: ${query}`);
};

// Simulates reserveAiQuotaUsage's transaction finding the pool already at
// its cap, so reserveAiQuota throws AI_MONTHLY_QUOTA_EXCEEDED before search()
// ever reaches provider.searchIntent.
const exhaustedTxStub = async fn => {
  try {
    const data = await fn({
      none: async () => {},
      one: async query => {
        if (/SELECT count\(\*\)/.test(query)) return { used: 999999 };
        throw new Error("must not insert once quota is exhausted");
      }
    });
    return { ok: true, data, error: null };
  } catch (error) {
    return { ok: false, data: null, error };
  }
};

const searchInput = { input: { query: "3 acre plot near Panvel", language: "en", page: 1, limit: 20 } };

test("a channel partner attached to an org with an active plan is charged against the org's pool exclusively — the personal plan lookup is never even issued", async () => {
  const calls = { org: [], personal: [] };
  await withPgStubs(
    {
      oneOrNone: planLookupStub({
        orgPlan: { aiMonthlyQuota: 3, organizationId: "org-1" },
        personalPlan: { aiMonthlyQuota: 999 }, // must never surface — proves no cross-contamination
        calls
      }),
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        search({ ...searchInput, actorId: "user-1" }),
        error => {
          assert.equal(error.code, "AI_MONTHLY_QUOTA_EXCEEDED");
          assert.match(error.message, /Your organization has used all 3/);
          return true;
        }
      );
    }
  );
  assert.deepEqual(calls.org, [["user-1"]]);
  assert.deepEqual(calls.personal, []);
});

test("a user with no qualifying org plan falls back to their own personal plan, after the org lookup comes back empty", async () => {
  const calls = { org: [], personal: [] };
  await withPgStubs(
    {
      oneOrNone: planLookupStub({ orgPlan: null, personalPlan: { aiMonthlyQuota: 7 }, calls }),
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        search({ ...searchInput, actorId: "user-1" }),
        error => {
          assert.equal(error.code, "AI_MONTHLY_QUOTA_EXCEEDED");
          assert.match(error.message, /You have used all 7/);
          assert.doesNotMatch(error.message, /organization/);
          return true;
        }
      );
    }
  );
  assert.deepEqual(calls.org, [["user-1"]]);
  assert.deepEqual(calls.personal, [["user-1"]]);
});

test("a user with neither an org plan nor a personal plan falls back to the ambient Free tier default", async () => {
  const calls = { org: [], personal: [] };
  await withPgStubs(
    {
      oneOrNone: planLookupStub({ orgPlan: null, personalPlan: null, calls }),
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        search({ ...searchInput, actorId: "user-1" }),
        error => {
          assert.equal(error.code, "AI_MONTHLY_QUOTA_EXCEEDED");
          assert.match(error.message, new RegExp(`used all ${DEFAULT_FREE_AI_MONTHLY_QUOTA}`));
          return true;
        }
      );
    }
  );
});

test("an org plan with no monthly cap (unlimited) skips reservation entirely — no advisory lock, no usage row, request proceeds past the quota gate", async () => {
  const calls = { org: [], personal: [] };
  let txCalls = 0;
  const stopSentinel = new Error("STOPPED_BEFORE_PROVIDER");
  await withPgStubs(
    {
      oneOrNone: planLookupStub({ orgPlan: { aiMonthlyQuota: null, organizationId: "org-1" }, calls }),
      tx: async () => {
        txCalls += 1;
        return { ok: false, data: null, error: new Error("must not reserve for unlimited quota") };
      },
      // searchCatalog() runs immediately after the quota gate, before any
      // OpenAI call — failing it here is how we prove execution got past
      // reserveAiQuota without ever touching the real provider.
      one: async () => {
        throw stopSentinel;
      }
    },
    async () => {
      await assert.rejects(search({ ...searchInput, actorId: "user-1" }), error => error === stopSentinel);
    }
  );
  assert.equal(txCalls, 0);
  assert.deepEqual(calls.personal, []);
});

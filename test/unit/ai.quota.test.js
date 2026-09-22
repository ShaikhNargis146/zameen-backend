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

test("countMonthlyUsageForUser is a read-only, personal-scope count — never used for enforcement", async () => {
  await withStub(
    "one",
    async (query, params) => {
      assert.match(query, /FROM ai\.usage_events/);
      assert.match(query, /user_id = \$1 AND organization_id IS NULL/);
      assert.deepEqual(params, ["user-1"]);
      return { ok: true, data: { count: 4 } };
    },
    async () => {
      const count = await aiRepository.countMonthlyUsageForUser("user-1");
      assert.equal(count, 4);
    }
  );
});

// ---------------------------------------------------------------------------
// Owner resolution, exercised end to end through ai.service.js's exported
// search() (the real reserveAiQuota/resolveOrganizationContext orchestration
// is private, so this is the only way to cover it without a mocking library
// — see the repo's existing convention of stubbing pg directly). Every case
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

// Routes the lookups an AI-quota request can issue —
// organizations.repository.findMembership (only when an explicit
// organizationId is sent: no org is ever auto-selected from the caller's
// memberships, see the "no organizationId" tests below for why), then
// commerce.repository.resolveEffectivePlanForOwner/ForUser's two-step
// lookup (the real active-plan query, then the live PLAN_FREE catalog
// fallback query only if that came back empty) — to canned responses,
// recording how many times each was actually queried.
const ownerLookupStub = ({
  membership = null,
  orgPlan = null,
  personalPlan = null,
  freePlan = null,
  calls
}) => async (query, params) => {
  if (/WHERE organization_id = \$1 AND user_id = \$2/.test(query)) {
    calls.membership.push(params);
    return { ok: true, data: membership };
  }
  if (/ps\.organization_id = \$1/.test(query)) {
    calls.org.push(params);
    return { ok: true, data: orgPlan };
  }
  if (/pr\.code = 'PLAN_FREE'/.test(query)) {
    calls.freePlanFallback.push(params);
    return { ok: true, data: freePlan };
  }
  if (/commerce\.plan_subscriptions/.test(query)) {
    calls.personal.push(params);
    return { ok: true, data: personalPlan };
  }
  throw new Error(`Unexpected oneOrNone query: ${query}`);
};
const newCalls = () => ({ membership: [], org: [], personal: [], freePlanFallback: [] });

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

test("no organizationId sent — quota resolves personally; an org membership is never even queried, no matter how generous some org's plan might be", async () => {
  const calls = newCalls();
  await withPgStubs(
    {
      oneOrNone: ownerLookupStub({ personalPlan: { aiMonthlyQuota: 7 }, calls }),
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
  // The whole point of Critical 3's fix: with no organizationId, membership
  // is never looked up at all — there is nothing to "auto-pick the biggest
  // quota" from, because the org-lookup path never runs in the first place.
  assert.deepEqual(calls.membership, []);
  assert.deepEqual(calls.org, []);
  assert.deepEqual(calls.personal, [["user-1"]]);
  assert.deepEqual(calls.freePlanFallback, []); // a real personal plan was found — never falls through to PLAN_FREE
});

test("no organizationId sent and no personal plan row exists — falls back to the live PLAN_FREE catalog row's aiMonthlyQuota, not a hardcoded default", async () => {
  const calls = newCalls();
  await withPgStubs(
    {
      oneOrNone: ownerLookupStub({
        personalPlan: null,
        freePlan: { aiMonthlyQuota: 9, code: "PLAN_FREE" },
        calls
      }),
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        search({ ...searchInput, actorId: "user-1" }),
        error => {
          assert.equal(error.code, "AI_MONTHLY_QUOTA_EXCEEDED");
          assert.match(error.message, /used all 9/);
          return true;
        }
      );
    }
  );
  assert.deepEqual(calls.personal, [["user-1"]]);
  assert.equal(calls.freePlanFallback.length, 1);
});

test("an explicit organizationId the caller is an active member of draws exclusively from that org's pool", async () => {
  const calls = newCalls();
  await withPgStubs(
    {
      oneOrNone: ownerLookupStub({
        membership: { organizationId: "org-1", userId: "user-1", role: "MEMBER", status: "ACTIVE" },
        orgPlan: { aiMonthlyQuota: 3, features: {} },
        personalPlan: { aiMonthlyQuota: 999 }, // must never surface — proves no cross-contamination
        calls
      }),
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        search({ ...searchInput, actorId: "user-1", input: { ...searchInput.input, organizationId: "org-1" } }),
        error => {
          assert.equal(error.code, "AI_MONTHLY_QUOTA_EXCEEDED");
          assert.match(error.message, /Your organization has used all 3/);
          return true;
        }
      );
    }
  );
  assert.deepEqual(calls.membership, [["org-1", "user-1"]]);
  assert.deepEqual(calls.org, [["org-1"]]);
  assert.deepEqual(calls.personal, []);
});

test("an explicit organizationId the caller is not an active member of is rejected outright — no silent fallback to the personal plan", async () => {
  const calls = newCalls();
  await withPgStubs(
    {
      oneOrNone: ownerLookupStub({ membership: null, calls }),
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        search({ ...searchInput, actorId: "user-1", input: { ...searchInput.input, organizationId: "org-1" } }),
        error => {
          assert.equal(error.code, "ORGANIZATION_ACCESS_DENIED");
          return true;
        }
      );
    }
  );
  assert.deepEqual(calls.membership, [["org-1", "user-1"]]);
  assert.deepEqual(calls.org, []);
  assert.deepEqual(calls.personal, []);
});

test("a user with no personal plan and PLAN_FREE not seeded falls back to the ambient DEFAULT_FREE_AI_MONTHLY_QUOTA constant as the last resort", async () => {
  await withPgStubs(
    {
      oneOrNone: ownerLookupStub({ personalPlan: null, freePlan: null, calls: newCalls() }),
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
  const calls = newCalls();
  let txCalls = 0;
  const stopSentinel = new Error("STOPPED_BEFORE_PROVIDER");
  await withPgStubs(
    {
      oneOrNone: ownerLookupStub({
        membership: { organizationId: "org-1", userId: "user-1", role: "MEMBER", status: "ACTIVE" },
        orgPlan: { aiMonthlyQuota: null, features: {} },
        calls
      }),
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
      await assert.rejects(
        search({ ...searchInput, actorId: "user-1", input: { ...searchInput.input, organizationId: "org-1" } }),
        error => error === stopSentinel
      );
    }
  );
  assert.equal(txCalls, 0);
  assert.deepEqual(calls.personal, []);
});

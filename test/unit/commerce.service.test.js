import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { DEFAULT_FREE_AI_MONTHLY_QUOTA } from "../../src/modules/ai/ai.service.js";
import {
  DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME,
  DEFAULT_FREE_LISTING_LIMIT
} from "../../src/modules/commerce/entitlements.service.js";
import { mySubscription } from "../../src/modules/commerce/commerce.service.js";
import { resolveUsageCycle } from "../../src/shared/usageCycle.js";

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

// ---------------------------------------------------------------------------
// mySubscription (GET /me/subscription) — the one response that powers every
// usage-bar/upgrade-banner UI surface. Every limit it reports must come from
// whatever plan row is *currently* active in the DB for this owner, never a
// value baked into this module, so that admins editing a plan's numbers via
// PATCH /admin/plans/:planId (same feature, different numbers) are reflected
// immediately with no deploy and no caching. Routes the concurrent
// Promise.all lookups mySubscription issues (plan resolution, per-feature
// usage counts) to canned rows via query-text sniffing, same convention as
// ai.quota.test.js's ownerLookupStub.
// ---------------------------------------------------------------------------

const activePlanRow = overrides => ({
  subscriptionStatus: "ACTIVE",
  startsAt: "2026-09-01T00:00:00.000Z",
  endsAt: "2026-10-01T00:00:00.000Z",
  id: "plan-1",
  productId: "product-1",
  code: "PLAN_PRO",
  name: "Pro",
  planType: "PAID",
  description: null,
  amountMinor: 99900,
  currency: "INR",
  durationDays: 30,
  listingLimit: null,
  featuredDays: 15,
  verificationIncluded: true,
  features: {},
  isActive: true,
  aiMonthlyQuota: null,
  ...overrides
});

const mySubscriptionOneOrNoneRouter = ({ activePlan = null, freePlan = null, featuredUsedRow = null, contactUsedRow = null }) =>
  async (query, params) => {
    if (/FROM commerce\.plan_subscriptions ps/.test(query) && /ps\.user_id = \$1/.test(query))
      return { ok: true, data: activePlan };
    if (/pr\.code = 'PLAN_FREE'/.test(query)) return { ok: true, data: freePlan };
    if (/FROM commerce\.subscription_usage/.test(query)) {
      const feature = params[1];
      if (feature === "FEATURED_LISTINGS") return { ok: true, data: featuredUsedRow };
      if (feature === "CONTACT_UNLOCKS") return { ok: true, data: contactUsedRow };
      throw new Error(`Unexpected subscription_usage feature: ${feature}`);
    }
    throw new Error(`Unexpected oneOrNone query: ${query}`);
  };

const mySubscriptionOneRouter = ({ listingsUsed = 0, aiUsed = 0 }) => async query => {
  if (/FROM marketplace\.listings/.test(query)) return { ok: true, data: { count: listingsUsed } };
  if (/FROM ai\.usage_events/.test(query)) return { ok: true, data: { count: aiUsed } };
  throw new Error(`Unexpected one query: ${query}`);
};

test("mySubscription reports every limit straight from the currently active DB plan row, not any value baked into this module", async () => {
  await withPgStubs(
    {
      oneOrNone: mySubscriptionOneOrNoneRouter({
        activePlan: activePlanRow({
          listingLimit: 17,
          features: { imagesPerProperty: 41, videosPerProperty: 6, featuredListingsPerMonth: 23, contactUnlocksPerMonth: 77 },
          aiMonthlyQuota: 13
        }),
        featuredUsedRow: { usedCount: 5 },
        contactUsedRow: { usedCount: 9 }
      }),
      one: mySubscriptionOneRouter({ listingsUsed: 3, aiUsed: 4 })
    },
    async () => {
      const result = await mySubscription("user-1");
      assert.deepEqual(result.limits, {
        activeListings: { used: 3, limit: 17, remaining: 14 },
        imagesPerProperty: { limit: 41 },
        videosPerProperty: { limit: 6 },
        featuredListings: { used: 5, limit: 23, remaining: 18 },
        aiQueries: { used: 4, limit: 13, remaining: 9 },
        contactUnlocks: { used: 9, limit: 77, remaining: 68 }
      });
    }
  );
});

// Same feature (contactUnlocks), different plan — the DB plan currently
// active for this owner decides both the number AND which reset semantics
// apply (see entitlements.service.js#consumeContactUnlock), never a fixed
// choice made by this module.
test("mySubscription reads the plan's LIFETIME contact-unlock cap (and queries the fixed lifetime period, not a calendar month) when the active plan sets contactUnlocksLifetime", async () => {
  let contactUsageQuery;
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM commerce\.plan_subscriptions ps/.test(query)) return { ok: true, data: activePlanRow({ features: { contactUnlocksLifetime: 5 } }) };
        if (/FROM commerce\.subscription_usage/.test(query) && params[1] === "CONTACT_UNLOCKS") {
          contactUsageQuery = query;
          assert.deepEqual(params, ["user-1", "CONTACT_UNLOCKS", new Date(0)]);
          return { ok: true, data: { usedCount: 2 } };
        }
        if (/FROM commerce\.subscription_usage/.test(query)) return { ok: true, data: null };
        throw new Error(`Unexpected oneOrNone query: ${query}`);
      },
      one: mySubscriptionOneRouter({})
    },
    async () => {
      const result = await mySubscription("user-1");
      assert.deepEqual(result.limits.contactUnlocks, { used: 2, limit: 5, remaining: 3 });
    }
  );
  assert.match(contactUsageQuery, /period_start = \$3/);
});

test("mySubscription reads the plan's MONTHLY contact-unlock allowance, anchored to this owner's own plan starts_at rather than the calendar month, when the active plan sets contactUnlocksPerMonth instead", async () => {
  const now = new Date("2026-09-20T00:00:00.000Z");
  const { periodStart: expectedPeriodStart } = resolveUsageCycle({ anchorStartsAt: "2026-09-01T00:00:00.000Z", now });
  let contactUsageQuery;
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM commerce\.plan_subscriptions ps/.test(query)) return { ok: true, data: activePlanRow({ features: { contactUnlocksPerMonth: 250 } }) };
        if (/FROM commerce\.subscription_usage/.test(query) && params[1] === "CONTACT_UNLOCKS") {
          contactUsageQuery = query;
          assert.deepEqual(params, ["user-1", "CONTACT_UNLOCKS", expectedPeriodStart]);
          return { ok: true, data: { usedCount: 100 } };
        }
        if (/FROM commerce\.subscription_usage/.test(query)) return { ok: true, data: null };
        throw new Error(`Unexpected oneOrNone query: ${query}`);
      },
      one: mySubscriptionOneRouter({})
    },
    async () => {
      const result = await mySubscription("user-1", { now });
      assert.deepEqual(result.limits.contactUnlocks, { used: 100, limit: 250, remaining: 150 });
    }
  );
  assert.match(contactUsageQuery, /period_start = \$3/);
});

// The direct "usage resets on renewal" assertion for the display endpoint:
// same feature, same calendar day, only the owner's own plan starts_at
// differs (a renewal happened) -- GET /me/subscription must report the
// renewed owner's contact-unlock usage against the NEW anchor's period, not
// whatever was already used under the pre-renewal anchor.
test("mySubscription reports a fresh (zero) contact-unlock usage window immediately after a same-day plan renewal, distinct from the pre-renewal period", async () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const renewedStartsAt = "2026-09-20T09:00:00.000Z"; // renewed hours earlier, same day
  const staleStartsAt = "2026-08-01T00:00:00.000Z"; // the pre-renewal anchor
  const { periodStart: freshPeriodStart } = resolveUsageCycle({ anchorStartsAt: renewedStartsAt, now });
  const { periodStart: stalePeriodStart } = resolveUsageCycle({ anchorStartsAt: staleStartsAt, now });
  assert.notDeepEqual(freshPeriodStart, stalePeriodStart);

  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM commerce\.plan_subscriptions ps/.test(query))
          return { ok: true, data: activePlanRow({ startsAt: renewedStartsAt, features: { contactUnlocksPerMonth: 250 } }) };
        if (/FROM commerce\.subscription_usage/.test(query) && params[1] === "CONTACT_UNLOCKS") {
          // The stale (pre-renewal) period still has usage on record, but it
          // must never be read once the anchor has moved to the new plan.
          if (params[2].getTime() === stalePeriodStart.getTime()) return { ok: true, data: { usedCount: 250 } };
          assert.equal(params[2].getTime(), freshPeriodStart.getTime());
          return { ok: true, data: null }; // fresh period has no usage row yet
        }
        if (/FROM commerce\.subscription_usage/.test(query)) return { ok: true, data: null };
        throw new Error(`Unexpected oneOrNone query: ${query}`);
      },
      one: mySubscriptionOneRouter({})
    },
    async () => {
      const result = await mySubscription("user-1", { now });
      assert.deepEqual(result.limits.contactUnlocks, { used: 0, limit: 250, remaining: 250 });
    }
  );
});

test("mySubscription reports contactUnlocks as unlimited (limit: null) when the active plan sets neither contactUnlocksLifetime nor contactUnlocksPerMonth", async () => {
  await withPgStubs(
    {
      oneOrNone: mySubscriptionOneOrNoneRouter({
        activePlan: activePlanRow({ features: {} }),
        contactUsedRow: { usedCount: 12 }
      }),
      one: mySubscriptionOneRouter({})
    },
    async () => {
      const result = await mySubscription("user-1");
      assert.deepEqual(result.limits.contactUnlocks, { used: 12, limit: null });
    }
  );
});

// The owner has never purchased anything (or let a paid plan lapse) — no
// active commerce.plan_subscriptions row at all. resolveEffectivePlanForUser
// falls back to the LIVE, admin-editable PLAN_FREE catalog row, so an admin
// changing PLAN_FREE's numbers takes effect for these owners immediately,
// with no deploy.
test("mySubscription falls back to the live, admin-editable PLAN_FREE catalog row (not a hardcoded default) when the owner has no active plan_subscriptions row", async () => {
  await withPgStubs(
    {
      oneOrNone: mySubscriptionOneOrNoneRouter({
        activePlan: null,
        freePlan: activePlanRow({
          subscriptionStatus: undefined,
          startsAt: undefined,
          endsAt: undefined,
          code: "PLAN_FREE",
          listingLimit: 99,
          features: { contactUnlocksLifetime: 42 },
          aiMonthlyQuota: 88
        }),
        contactUsedRow: { usedCount: 1 }
      }),
      one: mySubscriptionOneRouter({ listingsUsed: 0, aiUsed: 0 })
    },
    async () => {
      const result = await mySubscription("user-1");
      assert.equal(result.plan.code, "PLAN_FREE");
      assert.equal(result.limits.activeListings.limit, 99);
      assert.equal(result.limits.aiQueries.limit, 88);
      assert.deepEqual(result.limits.contactUnlocks, { used: 1, limit: 42, remaining: 41 });
    }
  );
});

// The absolute last resort: even the PLAN_FREE catalog row itself has never
// been seeded. Every ambient default used here must match its counterpart
// enforcement fallback (DEFAULT_FREE_LISTING_LIMIT, DEFAULT_FREE_AI_MONTHLY_QUOTA,
// DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME in entitlements.service.js) so display
// and enforcement never disagree about what an unseeded Free tier grants.
test("mySubscription's ambient Free-tier fallback matches every DEFAULT_FREE_* enforcement constant when PLAN_FREE itself is unseeded", async () => {
  await withPgStubs(
    {
      oneOrNone: mySubscriptionOneOrNoneRouter({
        activePlan: null,
        freePlan: null,
        contactUsedRow: { usedCount: 3 }
      }),
      one: mySubscriptionOneRouter({ listingsUsed: 1, aiUsed: 2 })
    },
    async () => {
      const result = await mySubscription("user-1");
      assert.equal(result.plan.code, "PLAN_FREE");
      assert.equal(result.status, "ACTIVE");
      assert.equal(result.currentPeriodStart, null);
      assert.equal(result.currentPeriodEnd, null);
      assert.deepEqual(result.limits.activeListings, { used: 1, limit: DEFAULT_FREE_LISTING_LIMIT, remaining: DEFAULT_FREE_LISTING_LIMIT - 1 });
      assert.deepEqual(result.limits.aiQueries, { used: 2, limit: DEFAULT_FREE_AI_MONTHLY_QUOTA, remaining: DEFAULT_FREE_AI_MONTHLY_QUOTA - 2 });
      assert.deepEqual(result.limits.contactUnlocks, {
        used: 3,
        limit: DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME,
        remaining: DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME - 3
      });
    }
  );
});

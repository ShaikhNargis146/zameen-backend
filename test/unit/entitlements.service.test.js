import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import {
  DEFAULT_FREE_LISTING_LIMIT,
  DEFAULT_FREE_TEAM_MEMBERS,
  assertFeature,
  grantFeaturedListing,
  grantFreePlan,
  resolveListingLimit,
  resolveMediaLimits,
  resolveTeamMemberLimit
} from "../../src/modules/commerce/entitlements.service.js";

test("Free-tier fallback constants match the plan's documented defaults", () => {
  assert.equal(DEFAULT_FREE_LISTING_LIMIT, 2);
  assert.equal(DEFAULT_FREE_TEAM_MEMBERS, 1);
});

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
// resolveListingLimit — owner resolution (personal vs org) and the
// unlimited (null) escape hatch. Read-only, NOT a check-then-throw "assert"
// (see listings.repository.js#submitWithinLimit for where the actual,
// lock-safe enforcement happens — listings.repository.test.js covers that).
// ---------------------------------------------------------------------------

test("resolveListingLimit resolves the owning user's own plan when organizationId is not set", async () => {
  const calls = [];
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        assert.match(query, /ps\.user_id = \$1 AND ps\.organization_id IS NULL/);
        calls.push(params);
        return { ok: true, data: { listingLimit: 2 } };
      }
    },
    async () => {
      const limit = await resolveListingLimit({ userId: "user-1", organizationId: null });
      assert.equal(limit, 2);
    }
  );
  assert.deepEqual(calls, [["user-1"]]);
});

test("resolveListingLimit resolves the org's shared plan when organizationId is set", async () => {
  const calls = [];
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        assert.match(query, /ps\.organization_id = \$1/);
        calls.push(params);
        return { ok: true, data: { listingLimit: 20 } };
      }
    },
    async () => {
      const limit = await resolveListingLimit({ userId: "user-1", organizationId: "org-1" });
      assert.equal(limit, 20);
    }
  );
  assert.deepEqual(calls, [["org-1"]]);
});

test("resolveListingLimit falls back to the Free-tier default when the owner has no active plan row", async () => {
  await withPgStubs({ oneOrNone: async () => ({ ok: true, data: null }) }, async () => {
    const limit = await resolveListingLimit({ userId: "user-1", organizationId: null });
    assert.equal(limit, DEFAULT_FREE_LISTING_LIMIT);
  });
});

test("resolveListingLimit normalizes a null listingLimit to null (unlimited)", async () => {
  await withPgStubs(
    { oneOrNone: async () => ({ ok: true, data: { listingLimit: null } }) },
    async () => {
      const limit = await resolveListingLimit({ userId: "user-1", organizationId: null });
      assert.equal(limit, null);
    }
  );
});

// ---------------------------------------------------------------------------
// resolveMediaLimits — read-only limit resolution, NOT a check-then-throw
// "assert" (see properties.repository.js#createMediaBatch, which enforces
// these limits itself, inside its own per-property advisory-locked
// transaction — properties.media-limit.test.js covers that).
// ---------------------------------------------------------------------------

test("resolveMediaLimits returns the owner's plan imagesPerProperty/videosPerProperty", async () => {
  const calls = [];
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        assert.match(query, /ps\.user_id = \$1 AND ps\.organization_id IS NULL/);
        calls.push(params);
        return { ok: true, data: { features: { imagesPerProperty: 5, videosPerProperty: 1 } } };
      }
    },
    async () => {
      const limits = await resolveMediaLimits({ userId: "user-1", organizationId: null });
      assert.deepEqual(limits, { imagesPerProperty: 5, videosPerProperty: 1 });
    }
  );
  assert.deepEqual(calls, [["user-1"]]);
});

test("resolveMediaLimits resolves the org's shared plan when organizationId is set", async () => {
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        assert.match(query, /ps\.organization_id = \$1/);
        assert.deepEqual(params, ["org-1"]);
        return { ok: true, data: { features: { imagesPerProperty: 20 } } };
      }
    },
    async () => {
      const limits = await resolveMediaLimits({ userId: "user-9", organizationId: "org-1" });
      assert.equal(limits.imagesPerProperty, 20);
    }
  );
});

test("resolveMediaLimits normalizes not-set limits to null (unlimited) when the owner has no active plan", async () => {
  await withPgStubs({ oneOrNone: async () => ({ ok: true, data: null }) }, async () => {
    const limits = await resolveMediaLimits({ userId: "user-1", organizationId: null });
    assert.deepEqual(limits, { imagesPerProperty: null, videosPerProperty: null });
  });
});

test("resolveMediaLimits does not throw when the plan row's features column is itself NULL", async () => {
  await withPgStubs(
    { oneOrNone: async () => ({ ok: true, data: { features: null } }) },
    async () => {
      const limits = await resolveMediaLimits({ userId: "user-1", organizationId: null });
      assert.deepEqual(limits, { imagesPerProperty: null, videosPerProperty: null });
    }
  );
});

// ---------------------------------------------------------------------------
// resolveTeamMemberLimit — read-only limit resolution, NOT a check-then-throw
// "assert" (that pattern is a TOCTOU race for a seat count -- see
// organizations.repository.js#addMember, which enforces this limit itself,
// inside its own advisory-locked transaction).
// ---------------------------------------------------------------------------

test("resolveTeamMemberLimit returns the org's plan teamMembers feature", async () => {
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        assert.match(query, /ps\.organization_id = \$1/);
        assert.deepEqual(params, ["org-1"]);
        return { ok: true, data: { features: { teamMembers: 3 } } };
      }
    },
    async () => {
      const limit = await resolveTeamMemberLimit("org-1");
      assert.equal(limit, 3);
    }
  );
});

test("resolveTeamMemberLimit falls back to the Free-tier default when the org has no active plan", async () => {
  await withPgStubs({ oneOrNone: async () => ({ ok: true, data: null }) }, async () => {
    const limit = await resolveTeamMemberLimit("org-1");
    assert.equal(limit, DEFAULT_FREE_TEAM_MEMBERS);
  });
});

test("resolveTeamMemberLimit normalizes a not-set/null teamMembers feature to null (unlimited)", async () => {
  await withPgStubs(
    { oneOrNone: async () => ({ ok: true, data: { features: {} } }) },
    async () => {
      const limit = await resolveTeamMemberLimit("org-1");
      assert.equal(limit, null);
    }
  );
});

// ---------------------------------------------------------------------------
// assertFeature — boolean gating resolved through the actor's own
// personal-or-org plan, not resource ownership.
// ---------------------------------------------------------------------------

test("assertFeature passes silently when the plan's feature flag is true", async () => {
  await withPgStubs(
    { oneOrNone: async () => ({ ok: true, data: { features: { verifiedBadge: true } } }) },
    async () => {
      await assertFeature({ userId: "user-1", organizationId: null }, "verifiedBadge");
    }
  );
});

test("assertFeature throws FEATURE_NOT_AVAILABLE when the flag is missing or false", async () => {
  await withPgStubs(
    { oneOrNone: async () => ({ ok: true, data: { features: { verifiedBadge: false } } }) },
    async () => {
      await assert.rejects(assertFeature({ userId: "user-1", organizationId: null }, "verifiedBadge"), error => {
        assert.equal(error.status, 403);
        assert.equal(error.code, "FEATURE_NOT_AVAILABLE");
        assert.deepEqual(error.details, { feature: "verifiedBadge", upgradeRequired: true });
        return true;
      });
    }
  );
});

test("assertFeature with no active plan at all (features = {}) also throws FEATURE_NOT_AVAILABLE", async () => {
  await withPgStubs({ oneOrNone: async () => ({ ok: true, data: null }) }, async () => {
    await assert.rejects(assertFeature({ userId: "user-1", organizationId: null }, "bulkUpload"));
  });
});

// ---------------------------------------------------------------------------
// grantFreePlan — tolerates a missing seed rather than failing registration,
// and is a no-op if the owner already has an active plan (guards against
// auth.service.js#verifyOtp's own documented concurrent-new-user race
// calling this twice for the same user -- createUser/addDefaultRoles are
// both ON CONFLICT DO NOTHING already; a plain INSERT here would not be).
// ---------------------------------------------------------------------------

// Dispatches the two distinct oneOrNone lookups grantFreePlan can issue —
// findActiveSubscriptionForOwner first, then findPlanByCode only if that
// came back empty — to canned responses.
const grantFreePlanOneOrNoneStub = ({ existingPlan = null, freePlan = null }) => async (query, params) => {
  if (/ps\.(user_id|organization_id) = \$1/.test(query)) return { ok: true, data: existingPlan };
  assert.match(query, /pr\.code = \$1/);
  assert.deepEqual(params, ["PLAN_FREE"]);
  return { ok: true, data: freePlan };
};

test("grantFreePlan is a no-op when the owner already has an active plan, without ever looking up the FREE plan", async () => {
  let planLookupCalled = false;
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/ps\.user_id = \$1 AND ps\.organization_id IS NULL/.test(query))
          return { ok: true, data: { id: "existing-subscription-1" } };
        planLookupCalled = true;
        throw new Error("must not look up the FREE plan once an active plan already exists");
      },
      one: async () => {
        throw new Error("must not grant a second active plan");
      }
    },
    async () => {
      await grantFreePlan({ userId: "user-1" });
    }
  );
  assert.equal(planLookupCalled, false);
});

test("grantFreePlan is a no-op when the FREE plan has not been seeded yet", async () => {
  let grantCalled = false;
  await withPgStubs(
    {
      oneOrNone: grantFreePlanOneOrNoneStub({ existingPlan: null, freePlan: null }),
      one: async () => {
        grantCalled = true;
        throw new Error("must not grant when no FREE plan is seeded");
      }
    },
    async () => {
      await grantFreePlan({ userId: "user-1" });
    }
  );
  assert.equal(grantCalled, false);
});

test("grantFreePlan inserts a real ACTIVE plan_subscriptions row for a user (not an order purchase) when the FREE plan is seeded", async () => {
  await withPgStubs(
    {
      oneOrNone: grantFreePlanOneOrNoneStub({ existingPlan: null, freePlan: { id: "plan-free-1" } }),
      one: async (query, params) => {
        assert.match(query, /INSERT INTO commerce\.plan_subscriptions/);
        assert.match(query, /VALUES \(\$1,\$2,\$3,\$4,\$5,'ACTIVE'\)/);
        assert.equal(params[0], "user-1");
        assert.equal(params[1], null);
        assert.equal(params[2], "plan-free-1");
        assert.equal(params[4], null); // endsAt — the FREE grant never expires
        return { ok: true, data: { id: "subscription-1" } };
      }
    },
    async () => {
      await grantFreePlan({ userId: "user-1" });
    }
  );
});

test("grantFreePlan inserts a real ACTIVE plan_subscriptions row for an organization, symmetric with the user path", async () => {
  await withPgStubs(
    {
      oneOrNone: grantFreePlanOneOrNoneStub({ existingPlan: null, freePlan: { id: "plan-free-1" } }),
      one: async (query, params) => {
        assert.match(query, /INSERT INTO commerce\.plan_subscriptions/);
        assert.equal(params[0], null); // userId
        assert.equal(params[1], "org-1"); // organizationId
        assert.equal(params[2], "plan-free-1");
        assert.equal(params[4], null); // endsAt — the FREE grant never expires
        return { ok: true, data: { id: "subscription-2" } };
      }
    },
    async () => {
      await grantFreePlan({ organizationId: "org-1" });
    }
  );
});

// ---------------------------------------------------------------------------
// grantFeaturedListing — the plan-included monthly allowance that lets
// POST /listings/:id/feature bypass checkout. Consuming the allowance and
// granting the promotion happen in one transaction (commerce.repository.js
// #grantFeaturedListingFromAllowance) so a failure in the promotion insert
// can never leave the allowance consumed with nothing actually featured.
// ---------------------------------------------------------------------------

test("grantFeaturedListing returns promotion: null, alreadyFeatured: false when the owner's plan has no featuredListingsPerMonth and the listing isn't already featured, without opening a transaction", async () => {
  let txCalled = false;
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/ps\.user_id = \$1 AND ps\.organization_id IS NULL/.test(query))
          return { ok: true, data: { features: {} } };
        assert.match(query, /FROM marketplace\.listing_promotions/);
        return { ok: true, data: null };
      },
      tx: async () => {
        txCalled = true;
        throw new Error("must not open a transaction when there is no allowance to consume");
      }
    },
    async () => {
      const result = await grantFeaturedListing({ userId: "user-1", organizationId: null }, "listing-1");
      assert.deepEqual(result, { promotion: null, alreadyFeatured: false });
    }
  );
  assert.equal(txCalled, false);
});

test("grantFeaturedListing reports alreadyFeatured: true even when the owner's plan has no allowance at all — not a misleading 'no allowance left'", async () => {
  let txCalled = false;
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/FROM marketplace\.listing_promotions/.test(query)) return { ok: true, data: { id: "existing-promotion-1" } };
        assert.match(query, /ps\.user_id = \$1 AND ps\.organization_id IS NULL/);
        return { ok: true, data: { features: {} } }; // FREE plan, no featuredListingsPerMonth
      },
      tx: async () => {
        txCalled = true;
        throw new Error("must not open a transaction when there is no allowance to consume");
      }
    },
    async () => {
      const result = await grantFeaturedListing({ userId: "user-1", organizationId: null }, "listing-1");
      assert.deepEqual(result, { promotion: null, alreadyFeatured: true });
    }
  );
  assert.equal(txCalled, false);
});

// Dispatches the two distinct t.oneOrNone lookups the transaction can issue
// -- the already-featured check first, then the usage-period lookup -- to
// canned responses.
const grantFeaturedListingTxOneOrNoneStub = ({ alreadyFeatured = null, usageRow = null }) => async query => {
  if (/FROM marketplace\.listing_promotions/.test(query)) return alreadyFeatured;
  assert.match(query, /FROM commerce\.subscription_usage/);
  return usageRow;
};

test("grantFeaturedListing returns alreadyFeatured: true without touching the usage ledger when the listing already has an active FEATURED promotion", async () => {
  let usageTouched = false;
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 15 } }),
      tx: async fn => {
        const data = await fn({
          none: async (query) => {
            if (/pg_advisory_xact_lock/.test(query)) return;
            usageTouched = true;
            throw new Error("must not touch the usage ledger once the listing is already featured");
          },
          one: async query => {
            usageTouched = true;
            throw new Error(`must not reach any t.one call: ${query}`);
          },
          oneOrNone: grantFeaturedListingTxOneOrNoneStub({ alreadyFeatured: { id: "existing-promotion-1" } })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await grantFeaturedListing({ userId: "user-1", organizationId: null }, "listing-1");
      assert.deepEqual(result, { promotion: null, alreadyFeatured: true });
    }
  );
  assert.equal(usageTouched, false);
});

test("grantFeaturedListing consumes one unit and grants the FEATURED promotion for the plan's featuredDays, in the same transaction", async () => {
  const calls = [];
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 15 } }),
      tx: async fn => {
        const data = await fn({
          none: async (query, params) => {
            calls.push(["none", query, params]);
            if (/pg_advisory_xact_lock/.test(query)) {
              assert.deepEqual(params, ["FEATURED_LISTINGS:user-1"]);
              return;
            }
            assert.match(query, /INSERT INTO commerce\.subscription_usage/);
            assert.deepEqual(params, [
              "user-1",
              null,
              "FEATURED_LISTINGS",
              "2026-09-01T00:00:00.000Z",
              "2026-10-01T00:00:00.000Z"
            ]);
          },
          one: async (query, params) => {
            calls.push(["one", query, params]);
            if (/date_trunc/.test(query))
              return { periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" };
            assert.match(query, /INSERT INTO marketplace\.listing_promotions/);
            assert.match(query, /'FEATURED'/);
            assert.deepEqual(params, ["listing-1", 15]);
            return { id: "promotion-1", endsAt: "2026-10-07T00:00:00.000Z" };
          },
          oneOrNone: grantFeaturedListingTxOneOrNoneStub({ alreadyFeatured: null, usageRow: null })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await grantFeaturedListing({ userId: "user-1", organizationId: null }, "listing-1");
      assert.deepEqual(result, { promotion: { id: "promotion-1", endsAt: "2026-10-07T00:00:00.000Z" }, alreadyFeatured: false });
    }
  );
  // Usage lock+count+write happens before the promotion insert, both in the same tx.
  assert.equal(calls[0][0], "none");
  assert.match(calls.at(-1)[1], /INSERT INTO marketplace\.listing_promotions/);
});

test("grantFeaturedListing preserves an explicitly-configured featuredDays of 0 rather than falling back to the 30-day default", async () => {
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 0 } }),
      tx: async fn => {
        const data = await fn({
          none: async () => {},
          one: async (query, params) => {
            if (/date_trunc/.test(query))
              return { periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" };
            assert.deepEqual(params, ["listing-1", 0]);
            return { id: "promotion-1", endsAt: "2026-09-01T00:00:00.000Z" };
          },
          oneOrNone: grantFeaturedListingTxOneOrNoneStub({ alreadyFeatured: null, usageRow: null })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await grantFeaturedListing({ userId: "user-1", organizationId: null }, "listing-1");
    }
  );
});

test("grantFeaturedListing returns promotion: null, alreadyFeatured: false once the period's usage is already at the plan's limit, without granting a promotion", async () => {
  let promotionInsertAttempted = false;
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 15 } }),
      tx: async fn => {
        const data = await fn({
          none: async () => {},
          one: async query => {
            if (/date_trunc/.test(query))
              return { periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" };
            promotionInsertAttempted = true;
            throw new Error("must not grant a promotion once the allowance is exhausted");
          },
          oneOrNone: grantFeaturedListingTxOneOrNoneStub({ alreadyFeatured: null, usageRow: { id: "usage-1", usedCount: 2 } })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await grantFeaturedListing({ userId: "user-1", organizationId: null }, "listing-1");
      assert.deepEqual(result, { promotion: null, alreadyFeatured: false });
    }
  );
  assert.equal(promotionInsertAttempted, false);
});

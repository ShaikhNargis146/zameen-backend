import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import {
  DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME,
  DEFAULT_FREE_LISTING_LIMIT,
  DEFAULT_FREE_TEAM_MEMBERS,
  assertFeature,
  consumeContactUnlock,
  grantFeaturedListing,
  grantFreePlan,
  resolveListingLimit,
  resolveMediaLimits,
  resolveTeamMemberLimit
} from "../../src/modules/commerce/entitlements.service.js";
import { resolveUsageCycle } from "../../src/shared/usageCycle.js";

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

test("grantFeaturedListing consumes one unit and grants the FEATURED promotion for the plan's featuredDays, in the same transaction, anchored to this owner's own plan starts_at (not the calendar month)", async () => {
  const calls = [];
  const planStartsAt = "2026-08-13T08:15:00.000Z";
  const now = new Date("2026-09-20T00:00:00.000Z");
  const { periodStart, periodEnd } = resolveUsageCycle({ anchorStartsAt: planStartsAt, now });
  await withPgStubs(
    {
      oneOrNone: async () => ({
        ok: true,
        data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 15, startsAt: planStartsAt }
      }),
      tx: async fn => {
        const data = await fn({
          any: async (query, params) => {
            calls.push(["any", query, params]);
            assert.match(query, /pg_advisory_xact_lock/);
            assert.deepEqual(params, ["FEATURED_LISTINGS:user-1"]);
          },
          none: async (query, params) => {
            calls.push(["none", query, params]);
            assert.match(query, /INSERT INTO commerce\.subscription_usage/);
            assert.deepEqual(params, ["user-1", null, "FEATURED_LISTINGS", periodStart, periodEnd]);
          },
          one: async (query, params) => {
            calls.push(["one", query, params]);
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
      const result = await grantFeaturedListing({ userId: "user-1", organizationId: null }, "listing-1", { now });
      assert.deepEqual(result, { promotion: { id: "promotion-1", endsAt: "2026-10-07T00:00:00.000Z" }, alreadyFeatured: false });
    }
  );
  // Usage lock+count+write happens before the promotion insert, both in the same tx.
  assert.equal(calls[0][0], "any");
  assert.match(calls.at(-1)[1], /INSERT INTO marketplace\.listing_promotions/);
});

// The exact scenario "usage resets on renewal" exists for: two otherwise
// identical requests, only the owner's plan starts_at differs (a renewal
// happened in between) -- the SAME calendar day, but the featured-listings
// usage ledger keys on a different period_start for each, so the renewed
// owner's counter starts fresh at 0 instead of inheriting whatever the
// pre-renewal owner had already used this calendar month.
test("grantFeaturedListing keys the usage period on the owner's CURRENT plan starts_at, so a same-day renewal opens a distinct (fresh) usage period from the one before it", async () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const beforeRenewal = resolveUsageCycle({ anchorStartsAt: "2026-08-01T00:00:00.000Z", now });
  const afterRenewal = resolveUsageCycle({ anchorStartsAt: "2026-09-20T09:00:00.000Z", now }); // renewed hours earlier, same day
  assert.notDeepEqual(beforeRenewal.periodStart, afterRenewal.periodStart);

  let insertedPeriodStart;
  await withPgStubs(
    {
      oneOrNone: async () => ({
        ok: true,
        data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 15, startsAt: "2026-09-20T09:00:00.000Z" }
      }),
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          none: async (query, params) => {
            insertedPeriodStart = params[3];
          },
          one: async () => ({ id: "promotion-1", endsAt: "2026-10-07T00:00:00.000Z" }),
          oneOrNone: grantFeaturedListingTxOneOrNoneStub({ alreadyFeatured: null, usageRow: null })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await grantFeaturedListing({ userId: "user-1", organizationId: null }, "listing-1", { now });
    }
  );
  assert.deepEqual(insertedPeriodStart, afterRenewal.periodStart);
  assert.notDeepEqual(insertedPeriodStart, beforeRenewal.periodStart);
});

test("grantFeaturedListing preserves an explicitly-configured featuredDays of 0 rather than falling back to the 30-day default", async () => {
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 0 } }),
      tx: async fn => {
        const data = await fn({
          any: async () => {},
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
          any: async () => {},
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

// ---------------------------------------------------------------------------
// consumeContactUnlock — resolved through the BUYER's own personal plan
// (never resolveEffectivePlanForOwner/an org), since a contact unlock is
// spent by whoever does the unlocking, not the listing's owner. FREE uses a
// lifetime cap (contactUnlocksLifetime); PRO/BUSINESS a monthly allowance
// (contactUnlocksPerMonth) via the same consumeUsageWithinTx machinery
// featured listings already uses, keyed under feature "CONTACT_UNLOCKS".
// ---------------------------------------------------------------------------

// Dispatches the transaction-scoped oneOrNone lookups consumeContactUnlock's
// repository transaction can issue -- the already-unlocked check first, then
// (only if not already unlocked and a limit is set) the usage-period lookup.
const contactUnlockTxOneOrNoneStub = ({ alreadyUnlocked = null, usageRow = null }) => async query => {
  if (/FROM marketplace\.contact_unlocks/.test(query)) return alreadyUnlocked;
  assert.match(query, /FROM commerce\.subscription_usage/);
  return usageRow;
};

test("consumeContactUnlock returns alreadyUnlocked: true without touching the usage ledger when this buyer already unlocked this listing", async () => {
  let usageTouched = false;
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { contactUnlocksLifetime: 5 } } }),
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          none: async () => {
            usageTouched = true;
            throw new Error("must not write anything once already unlocked");
          },
          one: async () => {
            usageTouched = true;
            throw new Error("must not reach any t.one call once already unlocked");
          },
          oneOrNone: contactUnlockTxOneOrNoneStub({ alreadyUnlocked: { id: "unlock-1" } })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await consumeContactUnlock("user-1", "listing-1");
      assert.deepEqual(result, { unlocked: true, alreadyUnlocked: true });
    }
  );
  assert.equal(usageTouched, false);
});

test("consumeContactUnlock on the FREE plan consumes one unit of the lifetime cap on a genuinely new unlock", async () => {
  const calls = [];
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { contactUnlocksLifetime: 5 } } }),
      tx: async fn => {
        const data = await fn({
          any: async (query, params) => {
            calls.push(["any", query, params]);
          },
          none: async (query, params) => {
            calls.push(["none", query, params]);
          },
          one: async () => {
            throw new Error("LIFETIME mode must not query date_trunc for a calendar period");
          },
          oneOrNone: contactUnlockTxOneOrNoneStub({ alreadyUnlocked: null, usageRow: null })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await consumeContactUnlock("user-1", "listing-1");
      assert.deepEqual(result, { unlocked: true, alreadyUnlocked: false });
    }
  );
  // Usage insert (lifetime period) happens before the contact_unlocks record insert.
  const noneCalls = calls.filter(([kind]) => kind === "none");
  assert.match(noneCalls[0][1], /INSERT INTO commerce\.subscription_usage/);
  assert.deepEqual(noneCalls[0][2], [
    "user-1",
    null,
    "CONTACT_UNLOCKS",
    new Date(0),
    new Date("9999-12-31T23:59:59.000Z")
  ]);
  assert.match(noneCalls[1][1], /INSERT INTO marketplace\.contact_unlocks/);
  assert.deepEqual(noneCalls[1][2], ["listing-1", "user-1"]);
});

test("consumeContactUnlock throws PLAN_LIMIT_REACHED once the FREE plan's lifetime cap is exhausted, without recording an unlock", async () => {
  let unlockRecorded = false;
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { contactUnlocksLifetime: 5 } } }),
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          none: async query => {
            unlockRecorded = true;
            throw new Error(`must not write once the cap is exhausted: ${query}`);
          },
          one: async () => {
            throw new Error("LIFETIME mode must not query date_trunc");
          },
          oneOrNone: contactUnlockTxOneOrNoneStub({ alreadyUnlocked: null, usageRow: { id: "usage-1", usedCount: 5 } })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(consumeContactUnlock("user-1", "listing-1"), error => {
        assert.equal(error.status, 403);
        assert.equal(error.code, "PLAN_LIMIT_REACHED");
        assert.deepEqual(error.details, { feature: "CONTACT_UNLOCKS", used: 5, limit: 5, upgradeRequired: true });
        return true;
      });
    }
  );
  assert.equal(unlockRecorded, false);
});

test("consumeContactUnlock on a PRO/BUSINESS plan uses the monthly allowance (contactUnlocksPerMonth), anchored to this buyer's own plan starts_at, not the lifetime cap or the calendar month", async () => {
  const planStartsAt = "2026-09-05T00:00:00.000Z";
  const now = new Date("2026-09-20T00:00:00.000Z");
  const { periodStart, periodEnd } = resolveUsageCycle({ anchorStartsAt: planStartsAt, now });
  let usageInsertParams;
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: { features: { contactUnlocksPerMonth: 50 }, startsAt: planStartsAt } }),
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          none: async (query, params) => {
            if (/INSERT INTO commerce\.subscription_usage/.test(query)) usageInsertParams = params;
          },
          one: async () => {
            throw new Error("consumeContactUnlock must never issue a t.one call");
          },
          oneOrNone: contactUnlockTxOneOrNoneStub({ alreadyUnlocked: null, usageRow: null })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await consumeContactUnlock("user-1", "listing-1", { now });
      assert.deepEqual(result, { unlocked: true, alreadyUnlocked: false });
    }
  );
  assert.deepEqual(usageInsertParams, ["user-1", null, "CONTACT_UNLOCKS", periodStart, periodEnd]);
});

// Mirrors the featured-listings renewal test above: same feature
// (CONTACT_UNLOCKS, MONTHLY mode), same calendar day, only the buyer's own
// plan starts_at differs (they renewed) -- the usage ledger must key on the
// new anchor, so the renewed buyer's allowance starts fresh at 0.
test("consumeContactUnlock's MONTHLY allowance keys on the buyer's CURRENT plan starts_at, so renewing mid-cycle opens a fresh contact-unlock period", async () => {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const beforeRenewal = resolveUsageCycle({ anchorStartsAt: "2026-08-01T00:00:00.000Z", now });
  const afterRenewal = resolveUsageCycle({ anchorStartsAt: "2026-09-20T09:00:00.000Z", now });
  assert.notDeepEqual(beforeRenewal.periodStart, afterRenewal.periodStart);

  let usageInsertParams;
  await withPgStubs(
    {
      oneOrNone: async () => ({
        ok: true,
        data: { features: { contactUnlocksPerMonth: 50 }, startsAt: "2026-09-20T09:00:00.000Z" }
      }),
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          none: async (query, params) => {
            if (/INSERT INTO commerce\.subscription_usage/.test(query)) usageInsertParams = params;
          },
          one: async () => {},
          oneOrNone: contactUnlockTxOneOrNoneStub({ alreadyUnlocked: null, usageRow: null })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await consumeContactUnlock("user-1", "listing-1", { now });
    }
  );
  assert.deepEqual(usageInsertParams[3], afterRenewal.periodStart);
  assert.notDeepEqual(usageInsertParams[3], beforeRenewal.periodStart);
});

test("consumeContactUnlock falls back to DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME when the owner has no active plan at all (FREE not seeded)", async () => {
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/ps\.user_id = \$1 AND ps\.organization_id IS NULL/.test(query)) return { ok: true, data: null };
        if (/pr\.code = 'PLAN_FREE'/.test(query)) return { ok: true, data: null };
        return { ok: true, data: null };
      },
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          none: async () => {},
          one: async () => {
            throw new Error("LIFETIME mode must not query date_trunc");
          },
          oneOrNone: contactUnlockTxOneOrNoneStub({ alreadyUnlocked: null, usageRow: { id: "usage-1", usedCount: DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME } })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(consumeContactUnlock("user-1", "listing-1"), error => {
        assert.equal(error.code, "PLAN_LIMIT_REACHED");
        assert.deepEqual(error.details, {
          feature: "CONTACT_UNLOCKS",
          used: DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME,
          limit: DEFAULT_FREE_CONTACT_UNLOCKS_LIFETIME,
          upgradeRequired: true
        });
        return true;
      });
    }
  );
});

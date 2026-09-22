import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { feature } from "../../src/modules/listings/listings.service.js";

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

const listing = { id: "listing-1", seller_user_id: "user-1", seller_organization_id: null };

// POST /listings/:id/feature — end to end through the real
// entitlements.service.js#grantFeaturedListing + commerce.repository.js
// #grantFeaturedListingFromAllowance code, stubbed at the pg level (this
// repo's existing convention for exercising service logic without a mocking
// library). The allowance consumption and the promotion grant happen inside
// one pg.tx call — a single commit, not two independently-committed writes.

test("feature() grants the FEATURED promotion for the plan's featuredDays when allowance remains, bypassing checkout", async () => {
  let promotionInsertCalls = 0;
  await withPgStubs(
    {
      oneOrNone: async () => ({
        ok: true,
        data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 15 }
      }),
      tx: async fn => {
        const data = await fn({
          none: async () => {},
          one: async (query, params) => {
            if (/date_trunc/.test(query))
              return { periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z" };
            promotionInsertCalls += 1;
            assert.match(query, /INSERT INTO marketplace\.listing_promotions/);
            assert.match(query, /'FEATURED'/);
            assert.deepEqual(params, ["listing-1", 15]);
            return { id: "promotion-1", endsAt: "2026-10-07T00:00:00.000Z" };
          },
          oneOrNone: async () => null
        });
        return { ok: true, data, error: null };
      },
      // The top-level pg.one/pg.oneOrNone (outside the transaction) must
      // never be hit by the promotion insert — proves it runs through t.one
      // inside the same tx as the usage write, not as a separate commit.
      one: async () => {
        throw new Error("promotion insert must run inside the transaction, not as a separate pg.one call");
      }
    },
    async () => {
      const result = await feature(listing);
      assert.deepEqual(result, {
        listingId: "listing-1",
        promotionType: "FEATURED",
        endsAt: "2026-10-07T00:00:00.000Z"
      });
    }
  );
  assert.equal(promotionInsertCalls, 1);
});

test("feature() throws LISTING_ALREADY_FEATURED (not PLAN_LIMIT_REACHED, and without consuming an allowance unit) when the listing already has an active FEATURED promotion", async () => {
  let usageTouched = false;
  await withPgStubs(
    {
      oneOrNone: async () => ({
        ok: true,
        data: { features: { featuredListingsPerMonth: 2 }, featuredDays: 15 }
      }),
      tx: async fn => {
        const data = await fn({
          none: async query => {
            if (/pg_advisory_xact_lock/.test(query)) return;
            usageTouched = true;
            throw new Error("must not touch the usage ledger once the listing is already featured");
          },
          one: async () => {
            usageTouched = true;
            throw new Error("must not reach the promotion insert");
          },
          oneOrNone: async query => {
            assert.match(query, /FROM marketplace\.listing_promotions/);
            return { id: "existing-promotion-1" };
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(feature(listing), error => {
        assert.equal(error.status, 409);
        assert.equal(error.code, "LISTING_ALREADY_FEATURED");
        return true;
      });
    }
  );
  assert.equal(usageTouched, false);
});

test("feature() falls back to a paid-promotion error, without opening a transaction, when no allowance is left", async () => {
  let txCalled = false;
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/FROM marketplace\.listing_promotions/.test(query)) return { ok: true, data: null }; // not already featured
        return { ok: true, data: { features: {} } }; // no featuredListingsPerMonth on this plan
      },
      tx: async () => {
        txCalled = true;
        throw new Error("must not open a transaction when there is no allowance to consume");
      }
    },
    async () => {
      await assert.rejects(feature(listing), error => {
        assert.equal(error.status, 403);
        assert.equal(error.code, "PLAN_LIMIT_REACHED");
        assert.deepEqual(error.details, {
          feature: "FEATURED_LISTINGS",
          upgradeRequired: true,
          checkoutRequired: true
        });
        return true;
      });
    }
  );
  assert.equal(txCalled, false);
});

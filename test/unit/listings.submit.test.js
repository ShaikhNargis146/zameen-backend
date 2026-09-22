import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { submit } from "../../src/modules/listings/listings.service.js";

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

const readyListing = {
  id: "listing-1",
  property_id: "property-1",
  review_status: "DRAFT",
  status: "INACTIVE",
  seller_user_id: "user-1",
  seller_organization_id: null
};

const oneOrNoneDispatch = ({ planLimit = null, scannerReady = true }) => async (query, params) => {
  if (/ps\.user_id = \$1 AND ps\.organization_id IS NULL/.test(query)) return { ok: true, data: { listingLimit: planLimit } };
  if (/FROM land\.v_property_scanner/.test(query))
    return { ok: true, data: { readinessScore: scannerReady ? 100 : 0, missingItems: scannerReady ? [] : ["Land details"] } };
  if (/WHERE l\.id = \$1 AND l\.deleted_at IS NULL/.test(query))
    return { ok: true, data: { id: "listing-1", reviewStatus: "PENDING", status: "INACTIVE" } };
  throw new Error(`unexpected oneOrNone query: ${query}`);
};

test("submit() resolves the limit and checks readiness before ever opening the enforcement transaction", async () => {
  let txCalled = false;
  await withPgStubs(
    {
      oneOrNone: oneOrNoneDispatch({ planLimit: 5, scannerReady: true }),
      tx: async fn => {
        txCalled = true;
        const data = await fn({
          none: async () => {},
          one: async () => ({ count: 1 }),
          oneOrNone: async () => ({ id: "listing-1" })
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await submit(readyListing);
      assert.equal(result.id, "listing-1");
    }
  );
  assert.equal(txCalled, true);
});

test("submit() throws LISTING_NOT_READY before opening a transaction when the property scanner isn't at 100", async () => {
  let txCalled = false;
  await withPgStubs(
    {
      oneOrNone: oneOrNoneDispatch({ planLimit: 5, scannerReady: false }),
      tx: async () => {
        txCalled = true;
        throw new Error("must not enforce the listing limit for a listing that isn't ready");
      }
    },
    async () => {
      await assert.rejects(submit(readyListing), error => {
        assert.equal(error.code, "LISTING_NOT_READY");
        return true;
      });
    }
  );
  assert.equal(txCalled, false);
});

test("submit() maps the repository's LIMIT_REACHED reason to a PLAN_LIMIT_REACHED HttpError with the resolved limit", async () => {
  await withPgStubs(
    {
      oneOrNone: oneOrNoneDispatch({ planLimit: 2, scannerReady: true }),
      tx: async fn => {
        const data = await fn({
          none: async () => {},
          one: async () => ({ count: 2 }), // at the limit
          oneOrNone: async () => {
            throw new Error("must not submit once the limit check has failed");
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(submit(readyListing), error => {
        assert.equal(error.status, 403);
        assert.equal(error.code, "PLAN_LIMIT_REACHED");
        assert.deepEqual(error.details, { feature: "ACTIVE_LISTINGS", used: 2, limit: 2, upgradeRequired: true });
        return true;
      });
    }
  );
});

test("submit() maps a plain submit conflict (reason: CONFLICT) to LISTING_SUBMIT_CONFLICT, distinct from the limit error", async () => {
  await withPgStubs(
    {
      oneOrNone: oneOrNoneDispatch({ planLimit: 5, scannerReady: true }),
      tx: async fn => {
        const data = await fn({
          none: async () => {},
          one: async () => ({ count: 1 }),
          oneOrNone: async () => null // UPDATE matched no row
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(submit(readyListing), error => {
        assert.equal(error.code, "LISTING_SUBMIT_CONFLICT");
        return true;
      });
    }
  );
});

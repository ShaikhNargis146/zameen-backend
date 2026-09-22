import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { approve } from "../../src/modules/listings/listings.service.js";

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

const summaryRow = {
  id: "listing-1",
  listingCode: "ZMN-L-ABC123",
  propertyId: "property-1",
  reviewStatus: "PENDING",
  status: "INACTIVE",
  expiresAt: null,
  seller: { id: "user-1", displayName: "Seller", phoneE164: null, email: null },
  organization: null
};

const oneOrNoneDispatch = ({ ownerFields, planLimit, listingCount }) => async (query, params) => {
  if (/WHERE l\.id = \$1 AND l\.deleted_at IS NULL/.test(query)) return { ok: true, data: summaryRow };
  if (/SELECT seller_user_id AS "sellerUserId"/.test(query)) return { ok: true, data: ownerFields };
  if (/ps\.user_id = \$1 AND ps\.organization_id IS NULL/.test(query))
    return { ok: true, data: { listingLimit: planLimit } };
  if (/pr\.code = 'PLAN_FREE'/.test(query)) return { ok: true, data: null };
  throw new Error(`unexpected oneOrNone query: ${query}`);
};

// Critical 2 — the audit found submit-time enforcement alone lets a seller
// submit several listings while under the limit and have an admin approve
// them all later, exceeding it. approve() must recheck the same live count,
// under the same lock submitWithinLimit uses, at approval time too.

test("approve() resolves the listing's own owner and enforces the active-listing limit inside the locked transaction", async () => {
  let txCalled = false;
  await withPgStubs(
    {
      oneOrNone: oneOrNoneDispatch({
        ownerFields: { sellerUserId: "user-1", sellerOrganizationId: null },
        planLimit: 5
      }),
      tx: async fn => {
        txCalled = true;
        const data = await fn({
          none: async () => {},
          one: async () => ({ count: 1 }), // under the limit of 5
          oneOrNone: async () => ({ id: "listing-1" })
        });
        return { ok: true, data, error: null };
      },
      none: async () => ({ ok: true, data: null }), // audit log
      any: async () => ({ ok: true, data: [] }) // notifySeller's recipient lookup — best-effort, no recipients needed for this test
    },
    async () => {
      const result = await approve({ id: "listing-1", approval: {}, actorId: "admin-1" });
      assert.equal(result.id, "listing-1");
    }
  );
  assert.equal(txCalled, true);
});

test("approve() throws PLAN_LIMIT_REACHED (not the paid-checkout error) when approving would push the owner over their active-listing limit, and never runs the UPDATE", async () => {
  let updateAttempted = false;
  await withPgStubs(
    {
      oneOrNone: oneOrNoneDispatch({
        ownerFields: { sellerUserId: "user-1", sellerOrganizationId: null },
        planLimit: 2
      }),
      tx: async fn => {
        const data = await fn({
          none: async () => {},
          one: async () => ({ count: 2 }), // already at the limit of 2
          oneOrNone: async () => {
            updateAttempted = true;
            throw new Error("must not approve once the limit check has failed");
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(
        approve({ id: "listing-1", approval: {}, actorId: "admin-1" }),
        error => {
          assert.equal(error.status, 403);
          assert.equal(error.code, "PLAN_LIMIT_REACHED");
          assert.deepEqual(error.details, {
            feature: "ACTIVE_LISTINGS",
            used: 2,
            limit: 2,
            upgradeRequired: true
          });
          return true;
        }
      );
    }
  );
  assert.equal(updateAttempted, false);
});

test("approve() resolves the org's pooled limit (not the individual submitter's) for an org-owned listing", async () => {
  const orgSummaryRow = { ...summaryRow, organization: { id: "org-1", name: "Acme", type: "BROKERAGE" } };
  const calls = { planLookup: [], count: [] };
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/WHERE l\.id = \$1 AND l\.deleted_at IS NULL/.test(query)) return { ok: true, data: orgSummaryRow };
        if (/SELECT seller_user_id AS "sellerUserId"/.test(query))
          return { ok: true, data: { sellerUserId: "user-1", sellerOrganizationId: "org-1" } };
        if (/ps\.organization_id = \$1/.test(query)) {
          calls.planLookup.push(params);
          return { ok: true, data: { listingLimit: 20 } };
        }
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      tx: async fn => {
        const data = await fn({
          none: async () => {},
          one: async (query, params) => {
            calls.count.push(params);
            return { count: 5 };
          },
          oneOrNone: async () => ({ id: "listing-1" })
        });
        return { ok: true, data, error: null };
      },
      none: async () => ({ ok: true, data: null }),
      any: async () => ({ ok: true, data: [] })
    },
    async () => {
      await approve({ id: "listing-1", approval: {}, actorId: "admin-1" });
    }
  );
  assert.deepEqual(calls.planLookup, [["org-1"]]);
  assert.deepEqual(calls.count, [["org-1"]]);
});

test("approve() throws LISTING_NOT_FOUND (not a raw TypeError) when the listing is withdrawn/deleted between the summary() read and the ownerFields() read", async () => {
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/WHERE l\.id = \$1 AND l\.deleted_at IS NULL/.test(query)) return { ok: true, data: summaryRow };
        if (/SELECT seller_user_id AS "sellerUserId"/.test(query)) return { ok: true, data: null }; // deleted_at now set -- no row
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      tx: async () => {
        throw new Error("must not open a transaction for a listing that no longer exists");
      }
    },
    async () => {
      await assert.rejects(approve({ id: "listing-1", approval: {}, actorId: "admin-1" }), error => {
        assert.equal(error.status, 404);
        assert.equal(error.code, "LISTING_NOT_FOUND");
        return true;
      });
    }
  );
});

test("approve() throws LISTING_NOT_FOUND immediately when the listing doesn't exist, without attempting owner/limit resolution", async () => {
  let ownerFieldsQueried = false;
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/WHERE l\.id = \$1 AND l\.deleted_at IS NULL/.test(query)) return { ok: true, data: null };
        ownerFieldsQueried = true;
        throw new Error("must not resolve owner/limit for a listing that doesn't exist");
      }
    },
    async () => {
      await assert.rejects(approve({ id: "missing", approval: {}, actorId: "admin-1" }), error => {
        assert.equal(error.code, "LISTING_NOT_FOUND");
        return true;
      });
    }
  );
  assert.equal(ownerFieldsQueried, false);
});

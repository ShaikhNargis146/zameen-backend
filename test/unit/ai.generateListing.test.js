import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { generateListing } from "../../src/modules/ai/ai.service.js";

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

// Simulates reserveAiQuotaUsage's transaction finding the pool already at
// its cap, so reserveAiQuota throws AI_MONTHLY_QUOTA_EXCEEDED before
// generateListing ever reaches the real OpenAI provider call.
const exhaustedTxStub = async fn => {
  try {
    const data = await fn({
      any: async () => {},
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

// generateListing resolves org context from the property's own ownership —
// resource-owner-based resolution, the one auto-pooling path Critical 3
// deliberately keeps, distinct from (and safer than) the removed
// "auto-detect across every org the caller belongs to" mechanism: the
// property is only ever loaded via ownedPropertyContext, whose own WHERE
// clause already guarantees the actor is either the creator or an active
// member of the owning org, so there is no risk of pooling against an
// unrelated org the caller merely happens to also belong to.

test("generateListing draws AI quota from the property's own owning organization when no organizationId is explicitly sent", async () => {
  const calls = { property: [], membership: [], org: [], personal: [] };
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM land\.properties p JOIN land\.property_types/.test(query)) {
          calls.property.push(params);
          return {
            ok: true,
            data: {
              propertyId: "property-1",
              ownerOrganizationId: "org-1",
              propertyType: "Plot",
              areaValue: 3,
              areaUnit: "Acre",
              locationName: "Panvel"
            }
          };
        }
        if (/WHERE organization_id = \$1 AND user_id = \$2/.test(query)) {
          calls.membership.push(params);
          return { ok: true, data: { organizationId: "org-1", userId: "user-1", role: "MEMBER", status: "ACTIVE" } };
        }
        if (/ps\.organization_id = \$1/.test(query)) {
          calls.org.push(params);
          return { ok: true, data: { aiMonthlyQuota: 3 } };
        }
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        generateListing({ actorId: "user-1", input: { propertyId: "property-1", language: "en" } }),
        error => {
          assert.equal(error.code, "AI_MONTHLY_QUOTA_EXCEEDED");
          assert.match(error.message, /Your organization has used all 3/);
          return true;
        }
      );
    }
  );
  assert.deepEqual(calls.property, [["property-1", "user-1"]]);
  assert.deepEqual(calls.org, [["org-1"]]);
  assert.deepEqual(calls.personal, []);
});

test("generateListing draws from the caller's personal plan when the property has no owning organization", async () => {
  const calls = { org: [], personal: [] };
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM land\.properties p JOIN land\.property_types/.test(query))
          return {
            ok: true,
            data: {
              propertyId: "property-1",
              ownerOrganizationId: null,
              propertyType: "Plot",
              areaValue: 3,
              areaUnit: "Acre",
              locationName: "Panvel"
            }
          };
        if (/ps\.organization_id = \$1/.test(query)) {
          calls.org.push(params);
          throw new Error("must not query an org plan when the property has no owning organization");
        }
        if (/commerce\.plan_subscriptions/.test(query)) {
          calls.personal.push(params);
          return { ok: true, data: { aiMonthlyQuota: 5 } };
        }
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        generateListing({ actorId: "user-1", input: { propertyId: "property-1", language: "en" } }),
        error => {
          assert.equal(error.code, "AI_MONTHLY_QUOTA_EXCEEDED");
          assert.match(error.message, /You have used all 5/);
          return true;
        }
      );
    }
  );
  assert.deepEqual(calls.org, []);
  assert.equal(calls.personal.length, 1);
});

test("generateListing with no propertyId at all draws from the caller's personal plan", async () => {
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/commerce\.plan_subscriptions/.test(query)) return { ok: true, data: { aiMonthlyQuota: 5 } };
        throw new Error(`unexpected oneOrNone query for a request with no propertyId: ${query}`);
      },
      tx: exhaustedTxStub
    },
    async () => {
      await assert.rejects(
        generateListing({ actorId: "user-1", input: { language: "en" } }),
        error => {
          assert.equal(error.code, "AI_MONTHLY_QUOTA_EXCEEDED");
          return true;
        }
      );
    }
  );
});

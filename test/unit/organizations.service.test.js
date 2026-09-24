import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { addMember, create } from "../../src/modules/organizations/organizations.service.js";

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

const organizationRow = {
  id: "org-1",
  name: "Acme Realty",
  type: "BROKERAGE",
  slug: null,
  phone: null,
  email: null,
  gstNumber: null,
  reraNumber: null,
  logoStorageKey: null,
  status: "PENDING"
};

// create() — symmetric with auth.service.js#verifyOtp granting an
// individual a FREE plan on registration: an organization now gets a real,
// admin-editable commerce.plan_subscriptions row on creation too, instead of
// permanently running on the ambient DEFAULT_FREE_* constants.

test("create() grants the new organization a real FREE plan row, symmetric with individual registration", async () => {
  const memberInsertCalls = [];
  const grantCalls = [];
  await withPgStubs(
    {
      tx: async fn => {
        const data = await fn({
          one: async query => {
            assert.match(query, /INSERT INTO account\.organizations/);
            return organizationRow;
          },
          none: async (query, params) => {
            assert.match(query, /INSERT INTO account\.organization_members/);
            memberInsertCalls.push(params);
          }
        });
        return { ok: true, data, error: null };
      },
      oneOrNone: async (query, params) => {
        if (/ps\.organization_id = \$1/.test(query)) return { ok: true, data: null }; // no existing active plan yet
        assert.match(query, /pr\.code = \$1/);
        assert.deepEqual(params, ["PLAN_FREE"]);
        return { ok: true, data: { id: "plan-free-1" } };
      },
      one: async (query, params) => {
        grantCalls.push([query, params]);
        assert.match(query, /INSERT INTO commerce\.plan_subscriptions/);
        assert.equal(params[0], null); // userId
        assert.equal(params[1], "org-1"); // organizationId
        assert.equal(params[2], "plan-free-1");
        return { ok: true, data: { id: "subscription-1" } };
      }
    },
    async () => {
      const result = await create({
        actorId: "actor-1",
        input: { name: "Acme Realty", type: "BROKERAGE" }
      });
      assert.equal(result.id, "org-1");
      assert.equal(result.logoUrl, null);
    }
  );
  assert.deepEqual(memberInsertCalls, [["org-1", "actor-1"]]);
  assert.equal(grantCalls.length, 1);
});

test("create() still succeeds when the FREE plan isn't seeded yet — the grant is tolerated, not required", async () => {
  await withPgStubs(
    {
      tx: async fn => {
        const data = await fn({
          one: async () => organizationRow,
          none: async () => {}
        });
        return { ok: true, data, error: null };
      },
      oneOrNone: async () => ({ ok: true, data: null }),
      one: async () => {
        throw new Error("must not grant when no FREE plan is seeded");
      }
    },
    async () => {
      const result = await create({
        actorId: "actor-1",
        input: { name: "Acme Realty", type: "BROKERAGE" }
      });
      assert.equal(result.id, "org-1");
    }
  );
});

// addMember() — resolves the team-member limit unconditionally (not just
// when the target looks new from an un-locked pre-check) and passes it into
// repository.addMember, which is the only place that actually enforces it,
// inside its own locked transaction. See organizations.repository.test.js
// for direct coverage of that locked enforcement; these tests cover the
// service-layer wiring (limit resolution -> repository call -> error mapping).

const activeOrg = { id: "org-1", name: "Acme Realty", type: "BROKERAGE", status: "ACTIVE" };
const ownerMembership = {
  organizationId: "org-1",
  userId: "actor-1",
  role: "OWNER",
  status: "ACTIVE",
  joinedAt: "2026-01-01T00:00:00.000Z"
};
const newUserSummary = { id: "user-2", name: "New User", phone: null, email: null };

const addMemberOneOrNoneStub = ({ targetMembership = null, planFeatures = {} }) => async (query, params) => {
  if (/FROM account\.organizations WHERE id = \$1/.test(query)) return { ok: true, data: activeOrg };
  if (/FROM account\.organization_members WHERE organization_id = \$1 AND user_id = \$2/.test(query))
    return { ok: true, data: params[1] === "actor-1" ? ownerMembership : targetMembership };
  if (/FROM auth\.users WHERE id = \$1/.test(query)) return { ok: true, data: newUserSummary };
  if (/ps\.organization_id = \$1/.test(query)) return { ok: true, data: { features: planFeatures } };
  throw new Error(`unexpected oneOrNone query: ${query}`);
};

test("addMember() rejects a new member once the org's plan-resolved team-member limit is reached, mapping the repository's TEAM_LIMIT_REACHED reason to PLAN_LIMIT_REACHED", async () => {
  await withPgStubs(
    {
      oneOrNone: addMemberOneOrNoneStub({ targetMembership: null, planFeatures: { teamMembers: 1 } }),
      tx: async fn => {
        const data = await fn({
          any: async () => {}, // advisory lock
          oneOrNone: async () => null, // fresh existing-membership check inside the lock
          one: async query => {
            if (/status IN \('ACTIVE','INVITED'\)/.test(query)) return { count: 1 }; // already at the limit of 1
            throw new Error("must not insert once at the team-member limit");
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(
        addMember({ organizationId: "org-1", actorId: "actor-1", userId: "user-2", role: "MEMBER" }),
        error => {
          assert.equal(error.status, 403);
          assert.equal(error.code, "PLAN_LIMIT_REACHED");
          assert.deepEqual(error.details, { feature: "TEAM_MEMBERS", used: 1, limit: 1, upgradeRequired: true });
          return true;
        }
      );
    }
  );
});

test("addMember() succeeds and returns the new membership when under the team-member limit", async () => {
  await withPgStubs(
    {
      oneOrNone: addMemberOneOrNoneStub({ targetMembership: null, planFeatures: { teamMembers: 5 } }),
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          oneOrNone: async () => null,
          one: async query => {
            if (/status IN \('ACTIVE','INVITED'\)/.test(query)) return { count: 1 }; // under the limit of 5
            assert.match(query, /INSERT INTO account\.organization_members/);
            return { role: "MEMBER", status: "INVITED", joinedAt: null };
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await addMember({ organizationId: "org-1", actorId: "actor-1", userId: "user-2", role: "MEMBER" });
      assert.deepEqual(result, { user: newUserSummary, role: "MEMBER", status: "INVITED", joinedAt: null });
    }
  );
});

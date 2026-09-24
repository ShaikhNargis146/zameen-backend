import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import {
  addMember,
  adminGet,
  adminSetMemberStatus,
  create,
  transition
} from "../../src/modules/organizations/organizations.service.js";

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

// addMember() — invite-by-email only (no explicit-userId path). Resolves the
// team-member limit unconditionally (not just when the target looks new from
// an un-locked pre-check) and passes it into repository.addMember, which is
// the only place that actually enforces it, inside its own locked
// transaction. See organizations.repository.test.js for direct coverage of
// that locked enforcement; these tests cover the service-layer wiring
// (invite resolution -> limit resolution -> repository call -> error mapping).

const activeOrg = { id: "org-1", name: "Acme Realty", type: "BROKERAGE", status: "ACTIVE" };
const ownerMembership = {
  organizationId: "org-1",
  userId: "actor-1",
  role: "OWNER",
  status: "ACTIVE",
  joinedAt: "2026-01-01T00:00:00.000Z"
};
const newUserSummary = { id: "user-2", name: "Jane Doe", phone: null, email: "new.hire@example.com" };
const defaultInvite = { email: "new.hire@example.com", firstName: "Jane", lastName: "Doe" };

const addMemberOneOrNoneStub = ({ targetMembership = null, planFeatures = {} }) => async (query, params) => {
  if (/FROM account\.organizations WHERE id = \$1/.test(query)) return { ok: true, data: activeOrg };
  if (/FROM account\.organization_members WHERE organization_id = \$1 AND user_id = \$2/.test(query))
    return { ok: true, data: params[1] === "actor-1" ? ownerMembership : targetMembership };
  if (/FROM auth\.users WHERE email = \$1/.test(query)) return { ok: true, data: newUserSummary }; // invite matches an already-registered email
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
        addMember({ organizationId: "org-1", actorId: "actor-1", role: "MEMBER", invite: defaultInvite }),
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
      const result = await addMember({ organizationId: "org-1", actorId: "actor-1", role: "MEMBER", invite: defaultInvite });
      assert.deepEqual(result, { user: newUserSummary, role: "MEMBER", status: "INVITED", joinedAt: null });
    }
  );
});

test("addMember() creates a new unverified account (no platform role granted) when no account exists for that email", async () => {
  const createdUser = { id: "user-3", name: "Jane Doe", phone: null, email: "new.hire@example.com" };
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM account\.organizations WHERE id = \$1/.test(query)) return { ok: true, data: activeOrg };
        if (/FROM account\.organization_members WHERE organization_id = \$1 AND user_id = \$2/.test(query))
          return { ok: true, data: params[1] === "actor-1" ? ownerMembership : null };
        if (/FROM auth\.users WHERE email = \$1/.test(query)) return { ok: true, data: null }; // no existing account
        if (/INSERT INTO auth\.users/.test(query)) {
          assert.deepEqual(params, ["new.hire@example.com", "Jane", "Doe", "Jane Doe"]);
          return { ok: true, data: createdUser };
        }
        if (/ps\.organization_id = \$1/.test(query)) return { ok: true, data: { features: { teamMembers: 5 } } };
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      none: async query => {
        throw new Error(`must not write to auth.user_roles — this endpoint grants no platform role: ${query}`);
      },
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          oneOrNone: async () => null,
          one: async query => {
            if (/status IN \('ACTIVE','INVITED'\)/.test(query)) return { count: 1 };
            assert.match(query, /INSERT INTO account\.organization_members/);
            return { role: "MEMBER", status: "INVITED", joinedAt: null };
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await addMember({ organizationId: "org-1", actorId: "actor-1", role: "MEMBER", invite: defaultInvite });
      assert.deepEqual(result, { user: createdUser, role: "MEMBER", status: "INVITED", joinedAt: null });
    }
  );
});

test("addMember() reuses an existing account matched by email, and never creates a duplicate", async () => {
  const existingUser = { id: "user-4", name: "Already Registered", phone: "+919876500009", email: "existing@example.com" };
  let userInsertAttempted = false;
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM account\.organizations WHERE id = \$1/.test(query)) return { ok: true, data: activeOrg };
        if (/FROM account\.organization_members WHERE organization_id = \$1 AND user_id = \$2/.test(query))
          return { ok: true, data: params[1] === "actor-1" ? ownerMembership : null };
        if (/FROM auth\.users WHERE email = \$1/.test(query)) return { ok: true, data: existingUser };
        if (/INSERT INTO auth\.users/.test(query)) {
          userInsertAttempted = true;
          throw new Error("must not create a new account when the email already has one");
        }
        if (/ps\.organization_id = \$1/.test(query)) return { ok: true, data: { features: { teamMembers: 5 } } };
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          oneOrNone: async () => null,
          one: async query => {
            if (/status IN \('ACTIVE','INVITED'\)/.test(query)) return { count: 1 };
            return { role: "ADMIN", status: "INVITED", joinedAt: null };
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await addMember({
        organizationId: "org-1",
        actorId: "actor-1",
        role: "ADMIN",
        invite: { email: "existing@example.com", firstName: "Ignored", lastName: "Ignored" }
      });
      assert.equal(result.user, existingUser);
    }
  );
  assert.equal(userInsertAttempted, false);
});

test("addMember() rejects changing an existing OWNER's role when the actor isn't themselves an OWNER", async () => {
  const existingOwner = { organizationId: "org-1", userId: "user-5", role: "OWNER", status: "ACTIVE" };
  const adminActorMembership = { organizationId: "org-1", userId: "actor-2", role: "ADMIN", status: "ACTIVE" };
  await withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/FROM account\.organizations WHERE id = \$1/.test(query)) return { ok: true, data: activeOrg };
        if (/FROM account\.organization_members WHERE organization_id = \$1 AND user_id = \$2/.test(query))
          return { ok: true, data: params[1] === "actor-2" ? adminActorMembership : existingOwner };
        if (/FROM auth\.users WHERE email = \$1/.test(query))
          return { ok: true, data: { id: "user-5", name: "Existing Owner", phone: null, email: "owner@example.com" } };
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      tx: async () => {
        throw new Error("must not reach repository.addMember once the OWNER_ROLE_REQUIRED guard has failed");
      }
    },
    async () => {
      await assert.rejects(
        addMember({
          organizationId: "org-1",
          actorId: "actor-2",
          role: "MEMBER",
          invite: { email: "owner@example.com", firstName: "Existing", lastName: "Owner" }
        }),
        error => {
          assert.equal(error.status, 403);
          assert.equal(error.code, "OWNER_ROLE_REQUIRED");
          return true;
        }
      );
    }
  );
});

// transition() — approve/suspend/reinstate. Unlike channel-partners (4
// statuses: PENDING/APPROVED/REJECTED/SUSPENDED, SUSPENDED terminal),
// organizations only has 3 (schema.sql: PENDING/ACTIVE/SUSPENDED), so
// suspend covers both "reject a pending org" and "shut down an active one",
// and reinstate is the only way back from SUSPENDED.

const buildOrgState = (status = "PENDING") => ({
  id: "org-1",
  name: "Acme Realty",
  type: "BROKERAGE",
  slug: null,
  phone: null,
  email: null,
  gstNumber: null,
  reraNumber: null,
  logoStorageKey: null,
  status
});

// setStatus's WHERE clause gates the transition atomically (status = ANY
// validStatuses) — this stub enforces that same rule so a test asserting
// INVALID_TRANSITION is actually exercising the guard, not just a fixed
// canned response.
const withOrgTransitionStubs = ({ status, calls }, callback) => {
  const state = buildOrgState(status);
  return withPgStubs(
    {
      oneOrNone: async (query, params) => {
        if (/SELECT .* FROM account\.organizations WHERE id = \$1/.test(query))
          return { ok: true, data: { ...state } };
        if (/UPDATE account\.organizations SET status = \$2/.test(query)) {
          const [, newStatus, validStatuses] = params;
          calls.setStatus.push(params);
          if (!validStatuses.includes(state.status)) return { ok: true, data: null };
          state.status = newStatus;
          return { ok: true, data: { ...state } };
        }
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      none: async (query, params) => {
        if (/INSERT INTO ops\.audit_logs/.test(query)) {
          calls.audit.push(params);
          return { ok: true, data: null };
        }
        throw new Error(`unexpected none query: ${query}`);
      }
    },
    callback
  );
};

const emptyTransitionCalls = () => ({ setStatus: [], audit: [] });

test("approve() moves a PENDING organization to ACTIVE and records the audit entry with the note folded into after_data", async () => {
  const calls = emptyTransitionCalls();
  await withOrgTransitionStubs({ status: "PENDING", calls }, async () => {
    const result = await transition({
      organizationId: "org-1",
      action: "approve",
      actorId: "admin-1",
      note: "Documents verified",
      request: { ip: "127.0.0.1", requestId: "req-1" }
    });
    assert.equal(result.status, "ACTIVE");
  });
  assert.deepEqual(calls.setStatus[0], ["org-1", "ACTIVE", ["PENDING"]]);
  assert.equal(calls.audit.length, 1);
  const [, action, , , afterJson] = calls.audit[0];
  assert.equal(action, "ORGANIZATION_APPROVED");
  assert.equal(JSON.parse(afterJson).note, "Documents verified");
});

test("approve() throws 409 INVALID_TRANSITION (not a silent no-op) when the organization is already ACTIVE, and never writes an audit row", async () => {
  const calls = emptyTransitionCalls();
  await withOrgTransitionStubs({ status: "ACTIVE", calls }, async () => {
    await assert.rejects(
      transition({ organizationId: "org-1", action: "approve", actorId: "admin-1", note: null, request: {} }),
      error => {
        assert.equal(error.status, 409);
        assert.equal(error.code, "INVALID_TRANSITION");
        return true;
      }
    );
  });
  assert.equal(calls.audit.length, 0);
});

test("suspend() moves a PENDING organization straight to SUSPENDED (rejecting it, since there's no separate REJECTED status)", async () => {
  const calls = emptyTransitionCalls();
  await withOrgTransitionStubs({ status: "PENDING", calls }, async () => {
    const result = await transition({
      organizationId: "org-1",
      action: "suspend",
      actorId: "admin-1",
      note: "GST number could not be verified",
      request: {}
    });
    assert.equal(result.status, "SUSPENDED");
  });
  assert.deepEqual(calls.setStatus[0], ["org-1", "SUSPENDED", ["PENDING", "ACTIVE"]]);
});

test("suspend() also moves an ACTIVE organization to SUSPENDED", async () => {
  const calls = emptyTransitionCalls();
  await withOrgTransitionStubs({ status: "ACTIVE", calls }, async () => {
    const result = await transition({
      organizationId: "org-1",
      action: "suspend",
      actorId: "admin-1",
      note: "Compliance violation",
      request: {}
    });
    assert.equal(result.status, "SUSPENDED");
  });
});

test("suspend() throws 409 INVALID_TRANSITION when the organization is already SUSPENDED", async () => {
  const calls = emptyTransitionCalls();
  await withOrgTransitionStubs({ status: "SUSPENDED", calls }, async () => {
    await assert.rejects(
      transition({ organizationId: "org-1", action: "suspend", actorId: "admin-1", note: "x", request: {} }),
      error => {
        assert.equal(error.code, "INVALID_TRANSITION");
        return true;
      }
    );
  });
});

test("reinstate() moves a SUSPENDED organization back to ACTIVE", async () => {
  const calls = emptyTransitionCalls();
  await withOrgTransitionStubs({ status: "SUSPENDED", calls }, async () => {
    const result = await transition({
      organizationId: "org-1",
      action: "reinstate",
      actorId: "admin-1",
      note: "Compliance review complete",
      request: {}
    });
    assert.equal(result.status, "ACTIVE");
  });
  assert.deepEqual(calls.setStatus[0], ["org-1", "ACTIVE", ["SUSPENDED"]]);
});

test("reinstate() throws 409 INVALID_TRANSITION when the organization is PENDING (never activated in the first place)", async () => {
  const calls = emptyTransitionCalls();
  await withOrgTransitionStubs({ status: "PENDING", calls }, async () => {
    await assert.rejects(
      transition({ organizationId: "org-1", action: "reinstate", actorId: "admin-1", note: null, request: {} }),
      error => {
        assert.equal(error.code, "INVALID_TRANSITION");
        return true;
      }
    );
  });
});

// adminGet() — unlike the public get(), inlines the member list so an admin
// reviewing a PENDING/SUSPENDED org (which they're likely not a member of)
// can still see who's in it without a second, membership-gated call to
// GET /organizations/{id}/members.
test("adminGet() inlines the organization's members, same DTO shape listMembers returns", async () => {
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/FROM account\.organizations WHERE id = \$1/.test(query))
          return { ok: true, data: buildOrgState("PENDING") };
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      any: async query => {
        if (/FROM account\.organization_members m/.test(query))
          return {
            ok: true,
            data: [
              {
                id: "user-1",
                name: "Owner Name",
                phone: "+919876543210",
                email: "owner@example.com",
                role: "OWNER",
                status: "ACTIVE",
                joinedAt: "2026-01-01T00:00:00.000Z"
              }
            ]
          };
        throw new Error(`unexpected any query: ${query}`);
      }
    },
    async () => {
      const result = await adminGet("org-1");
      assert.equal(result.status, "PENDING");
      assert.deepEqual(result.members, [
        {
          user: { id: "user-1", name: "Owner Name", phone: "+919876543210", email: "owner@example.com" },
          role: "OWNER",
          status: "ACTIVE",
          joinedAt: "2026-01-01T00:00:00.000Z"
        }
      ]);
    }
  );
});

test("adminGet() returns an empty members array for an organization with none matched (defensive — every org has at least an OWNER in practice)", async () => {
  await withPgStubs(
    {
      oneOrNone: async () => ({ ok: true, data: buildOrgState("ACTIVE") }),
      any: async () => ({ ok: true, data: [] })
    },
    async () => {
      const result = await adminGet("org-1");
      assert.deepEqual(result.members, []);
    }
  );
});

// adminSetMemberStatus() — admin-only, bypasses requireManager entirely
// (the route is requireAdmin-gated, not membership-gated), and unlike
// removeMember can move a member to ANY of the 3 valid statuses from any
// current one, including reactivating a REMOVED member with no fresh
// invite-accept cycle and no team-member seat-limit re-check.

const buildMemberState = (status = "ACTIVE", role = "MEMBER") => ({ role, status });

const withMemberStatusStubs = ({ memberState, calls }, callback) =>
  withPgStubs(
    {
      oneOrNone: async query => {
        if (/FROM account\.organizations WHERE id = \$1/.test(query))
          return { ok: true, data: buildOrgState("ACTIVE") };
        if (/FROM auth\.users WHERE id = \$1/.test(query))
          return { ok: true, data: { id: "user-2", name: "Target User", phone: null, email: "target@example.com" } };
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      none: async (query, params) => {
        if (/INSERT INTO ops\.audit_logs/.test(query)) {
          calls.audit.push(params);
          return { ok: true, data: null };
        }
        throw new Error(`unexpected none query: ${query}`);
      },
      tx: async fn => {
        try {
          const data = await fn({
            any: async () => {}, // advisory lock
            oneOrNone: async () => (memberState ? { ...memberState } : null), // the "before" read
            one: async (query, params) => {
              calls.setStatus.push(params);
              const [, , newStatus] = params;
              memberState.status = newStatus;
              return { role: memberState.role, status: memberState.status, joinedAt: memberState.joinedAt || null };
            }
          });
          return { ok: true, data, error: null };
        } catch (error) {
          return { ok: false, data: null, error };
        }
      }
    },
    callback
  );

const emptyMemberCalls = () => ({ setStatus: [], audit: [] });

test("adminSetMemberStatus() moves an INVITED member to ACTIVE, with no requirement that the admin be a member of that org themselves", async () => {
  const calls = emptyMemberCalls();
  const memberState = buildMemberState("INVITED");
  await withMemberStatusStubs({ memberState, calls }, async () => {
    const result = await adminSetMemberStatus({
      organizationId: "org-1",
      userId: "user-2",
      status: "ACTIVE",
      actorId: "admin-1",
      request: {}
    });
    assert.equal(result.status, "ACTIVE");
    assert.equal(result.user.id, "user-2");
  });
  assert.deepEqual(calls.setStatus[0], ["org-1", "user-2", "ACTIVE"]);
  assert.equal(calls.audit.length, 1);
});

test("adminSetMemberStatus() reactivates a REMOVED member straight to ACTIVE — no invite-accept cycle, no seat-limit check (that's addMember's own re-invite path, not this admin override)", async () => {
  const calls = emptyMemberCalls();
  const memberState = buildMemberState("REMOVED", "MEMBER");
  await withMemberStatusStubs({ memberState, calls }, async () => {
    const result = await adminSetMemberStatus({
      organizationId: "org-1",
      userId: "user-2",
      status: "ACTIVE",
      actorId: "admin-1",
      request: {}
    });
    assert.equal(result.status, "ACTIVE");
  });
});

test("adminSetMemberStatus() moves an ACTIVE non-owner member to REMOVED", async () => {
  const calls = emptyMemberCalls();
  const memberState = buildMemberState("ACTIVE", "MEMBER");
  await withMemberStatusStubs({ memberState, calls }, async () => {
    const result = await adminSetMemberStatus({
      organizationId: "org-1",
      userId: "user-2",
      status: "REMOVED",
      actorId: "admin-1",
      request: {}
    });
    assert.equal(result.status, "REMOVED");
  });
});

test("adminSetMemberStatus() throws 404 MEMBER_NOT_FOUND when no membership row exists for that user in that org", async () => {
  const calls = emptyMemberCalls();
  await withMemberStatusStubs({ memberState: null, calls }, async () => {
    await assert.rejects(
      adminSetMemberStatus({ organizationId: "org-1", userId: "user-9", status: "ACTIVE", actorId: "admin-1", request: {} }),
      error => {
        assert.equal(error.status, 404);
        assert.equal(error.code, "MEMBER_NOT_FOUND");
        return true;
      }
    );
  });
  assert.equal(calls.audit.length, 0);
});

test("adminSetMemberStatus() throws 400 LAST_OWNER when demoting the org's only active OWNER away from ACTIVE, and never writes an audit row", async () => {
  const calls = emptyMemberCalls();
  const memberState = buildMemberState("ACTIVE", "OWNER");
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/FROM account\.organizations WHERE id = \$1/.test(query))
          return { ok: true, data: buildOrgState("ACTIVE") };
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      none: async (query, params) => {
        calls.audit.push(params);
        return { ok: true, data: null };
      },
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          oneOrNone: async () => ({ ...memberState }),
          one: async query => {
            if (/role = 'OWNER' AND status = 'ACTIVE'/.test(query)) return { count: 1 }; // the only active owner
            throw new Error("must not update once the last-owner guard has failed");
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      await assert.rejects(
        adminSetMemberStatus({ organizationId: "org-1", userId: "owner-1", status: "REMOVED", actorId: "admin-1", request: {} }),
        error => {
          assert.equal(error.status, 400);
          assert.equal(error.code, "LAST_OWNER");
          return true;
        }
      );
    }
  );
  assert.equal(calls.audit.length, 0);
});

test("adminSetMemberStatus() allows demoting an OWNER away from ACTIVE when at least one other active owner remains (the guard isn't just 'any OWNER change is blocked')", async () => {
  const calls = emptyMemberCalls();
  const memberState = buildMemberState("ACTIVE", "OWNER");
  await withPgStubs(
    {
      oneOrNone: async query => {
        if (/FROM account\.organizations WHERE id = \$1/.test(query))
          return { ok: true, data: buildOrgState("ACTIVE") };
        if (/FROM auth\.users WHERE id = \$1/.test(query))
          return { ok: true, data: { id: "owner-1", name: "Co-owner", phone: null, email: "co@example.com" } };
        throw new Error(`unexpected oneOrNone query: ${query}`);
      },
      none: async (query, params) => {
        calls.audit.push(params);
        return { ok: true, data: null };
      },
      tx: async fn => {
        const data = await fn({
          any: async () => {},
          oneOrNone: async () => ({ ...memberState }),
          one: async query => {
            if (/role = 'OWNER' AND status = 'ACTIVE'/.test(query)) return { count: 2 }; // this org has two active owners
            memberState.status = "REMOVED";
            return { role: memberState.role, status: memberState.status, joinedAt: null };
          }
        });
        return { ok: true, data, error: null };
      }
    },
    async () => {
      const result = await adminSetMemberStatus({
        organizationId: "org-1",
        userId: "owner-1",
        status: "REMOVED",
        actorId: "admin-1",
        request: {}
      });
      assert.equal(result.status, "REMOVED");
    }
  );
  assert.equal(calls.audit.length, 1);
});

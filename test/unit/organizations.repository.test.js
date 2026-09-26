import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { addMember } from "../../src/modules/organizations/organizations.repository.js";

// addMember runs everything — the advisory lock, the existing-membership
// read, the last-owner guard, the team-member-seat check, and the insert —
// inside one transaction (organizations.repository.js#organizationMembershipLockKey),
// so two concurrent invites for two different new users can't both pass a
// stale "under the limit" read before either commits. These tests exercise
// that transaction directly via a stubbed pg.tx, mirroring this repo's
// existing convention (see ai.quota.test.js) for testing transactional
// repository logic without a mocking library.

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

const stubT = ({ existing = null, ownerCount = null, seatCount = null, insertResult = null }) => {
  const calls = { lock: [], existing: [], ownerCount: [], seatCount: [], insert: [] };
  return {
    calls,
    t: {
      any: async (query, params) => {
        assert.match(query, /pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
        calls.lock.push(params);
      },
      oneOrNone: async (query, params) => {
        assert.match(query, /SELECT role, status FROM account\.organization_members WHERE organization_id = \$1 AND user_id = \$2/);
        calls.existing.push(params);
        return existing;
      },
      one: async (query, params) => {
        if (/role = 'OWNER' AND status = 'ACTIVE'/.test(query)) {
          calls.ownerCount.push(params);
          return ownerCount;
        }
        if (/status IN \('ACTIVE','INVITED'\)/.test(query)) {
          calls.seatCount.push(params);
          return seatCount;
        }
        assert.match(query, /INSERT INTO account\.organization_members/);
        calls.insert.push(params);
        return insertResult;
      }
    }
  };
};

test("a genuinely new member under the team-member limit is inserted, with the seat check inside the same locked transaction", async () => {
  const { t, calls } = stubT({
    existing: null,
    seatCount: { count: 1 },
    insertResult: { role: "MEMBER", status: "INVITED", joinedAt: null }
  });
  await withTxStub(t, async () => {
    const result = await addMember("org-1", "user-2", "MEMBER", { teamMemberLimit: 2 });
    assert.deepEqual(result, { membership: { role: "MEMBER", status: "INVITED", joinedAt: null }, reason: null });
  });
  assert.deepEqual(calls.lock, [["org-1:organization-membership"]]);
  assert.deepEqual(calls.seatCount, [["org-1"]]);
  assert.equal(calls.insert.length, 1);
});

test("a new member at the team-member limit is rejected, and the insert is never attempted", async () => {
  const { t, calls } = stubT({ existing: null, seatCount: { count: 2 } });
  await withTxStub(t, async () => {
    const result = await addMember("org-1", "user-2", "MEMBER", { teamMemberLimit: 2 });
    assert.deepEqual(result, { membership: null, reason: "TEAM_LIMIT_REACHED", used: 2 });
  });
  assert.equal(calls.insert.length, 0);
});

test("re-inviting a previously REMOVED member is treated as consuming a new seat (their row exists but holds no seat), and is rejected at the team-member limit", async () => {
  const { t, calls } = stubT({ existing: { role: "MEMBER", status: "REMOVED" }, seatCount: { count: 2 } });
  await withTxStub(t, async () => {
    const result = await addMember("org-1", "user-2", "MEMBER", { teamMemberLimit: 2 });
    assert.deepEqual(result, { membership: null, reason: "TEAM_LIMIT_REACHED", used: 2 });
  });
  assert.equal(calls.seatCount.length, 1);
  assert.equal(calls.insert.length, 0);
});

test("re-inviting a previously REMOVED member under the limit succeeds", async () => {
  const { t, calls } = stubT({
    existing: { role: "MEMBER", status: "REMOVED" },
    seatCount: { count: 1 },
    insertResult: { role: "MEMBER", status: "INVITED", joinedAt: null }
  });
  await withTxStub(t, async () => {
    const result = await addMember("org-1", "user-2", "MEMBER", { teamMemberLimit: 2 });
    assert.equal(result.reason, null);
  });
  assert.equal(calls.insert.length, 1);
});

test("a role change on an already-existing member never consumes a seat, even if the org is at its team-member limit", async () => {
  const { t, calls } = stubT({
    existing: { role: "MEMBER", status: "ACTIVE" },
    insertResult: { role: "ADMIN", status: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z" }
  });
  await withTxStub(t, async () => {
    // teamMemberLimit is deliberately tiny (0) -- if the seat check ran for
    // an existing member this would incorrectly reject the role change.
    const result = await addMember("org-1", "user-2", "ADMIN", { teamMemberLimit: 0 });
    assert.equal(result.reason, null);
  });
  assert.equal(calls.seatCount.length, 0);
  assert.equal(calls.insert.length, 1);
});

test("teamMemberLimit: null (unlimited) skips the seat-count query entirely", async () => {
  const { t, calls } = stubT({
    existing: null,
    insertResult: { role: "MEMBER", status: "INVITED", joinedAt: null }
  });
  await withTxStub(t, async () => {
    await addMember("org-1", "user-2", "MEMBER", { teamMemberLimit: null });
  });
  assert.equal(calls.seatCount.length, 0);
  assert.equal(calls.insert.length, 1);
});

test("omitting the options argument defaults to unlimited (backward-compatible call shape)", async () => {
  const { t, calls } = stubT({
    existing: null,
    insertResult: { role: "MEMBER", status: "INVITED", joinedAt: null }
  });
  await withTxStub(t, async () => {
    await addMember("org-1", "user-2", "MEMBER");
  });
  assert.equal(calls.seatCount.length, 0);
});

test("the last-owner guard still runs before, and independently of, the team-member-limit check", async () => {
  const { t, calls } = stubT({
    existing: { role: "OWNER", status: "ACTIVE" },
    ownerCount: { count: 1 }
  });
  await withTxStub(t, async () => {
    const result = await addMember("org-1", "user-2", "MEMBER", { teamMemberLimit: 5 });
    assert.deepEqual(result, { membership: null, reason: "LAST_OWNER" });
  });
  assert.equal(calls.ownerCount.length, 1);
  assert.equal(calls.seatCount.length, 0); // existing member -- team-limit check never applies
  assert.equal(calls.insert.length, 0);
});

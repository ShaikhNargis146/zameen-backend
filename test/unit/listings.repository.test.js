import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import { approveWithinLimit, submitWithinLimit } from "../../src/modules/listings/listings.repository.js";

// submitWithinLimit runs the advisory lock, the active-listing count, and
// the submit UPDATE inside one transaction, so two concurrent submissions
// from the same owner (different listings) can't both pass a stale
// "under the limit" read before either commits. Exercised directly via a
// stubbed pg.tx, mirroring this repo's existing convention (see
// ai.quota.test.js, organizations.repository.test.js) for transactional
// repository logic.

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

const stubT = ({ count = null, updateResult = null }) => {
  const calls = { lock: [], count: [], update: [] };
  return {
    calls,
    t: {
      any: async (query, params) => {
        assert.match(query, /pg_advisory_xact_lock\(hashtext\(\$1::text\)\)/);
        calls.lock.push(params);
      },
      one: async (query, params) => {
        assert.match(query, /SELECT count\(\*\)::int AS count FROM marketplace\.listings/);
        calls.count.push(params);
        return count;
      },
      oneOrNone: async (query, params) => {
        assert.match(query, /UPDATE marketplace\.listings SET review_status = 'PENDING'/);
        calls.update.push(params);
        return updateResult;
      }
    }
  };
};

test("submitting under the owner's active-listing limit locks per-owner, counts, then submits, all in one transaction", async () => {
  const { t, calls } = stubT({ count: { count: 1 }, updateResult: { id: "listing-1" } });
  await withTxStub(t, async () => {
    const result = await submitWithinLimit({ id: "listing-1", userId: "user-1", organizationId: null, limit: 2 });
    assert.deepEqual(result, { submitted: { id: "listing-1" }, reason: null });
  });
  assert.deepEqual(calls.lock, [["ACTIVE_LISTINGS:user-1"]]);
  assert.deepEqual(calls.count, [["user-1"]]);
  assert.equal(calls.update.length, 1);
});

test("submitting at the owner's active-listing limit is rejected, and the UPDATE is never attempted", async () => {
  const { t, calls } = stubT({ count: { count: 2 } });
  await withTxStub(t, async () => {
    const result = await submitWithinLimit({ id: "listing-1", userId: "user-1", organizationId: null, limit: 2 });
    assert.deepEqual(result, { submitted: null, reason: "LIMIT_REACHED", used: 2 });
  });
  assert.equal(calls.update.length, 0);
});

test("an org-owned listing locks and counts against the org's shared pool, not the individual submitter", async () => {
  const { t, calls } = stubT({ count: { count: 3 }, updateResult: { id: "listing-2" } });
  await withTxStub(t, async () => {
    await submitWithinLimit({ id: "listing-2", userId: "user-1", organizationId: "org-1", limit: 5 });
  });
  assert.deepEqual(calls.lock, [["ACTIVE_LISTINGS:org-1"]]);
  assert.deepEqual(calls.count, [["org-1"]]);
});

test("limit: null (unlimited) skips the count query entirely and goes straight to the UPDATE", async () => {
  const { t, calls } = stubT({ updateResult: { id: "listing-1" } });
  await withTxStub(t, async () => {
    await submitWithinLimit({ id: "listing-1", userId: "user-1", organizationId: null, limit: null });
  });
  assert.equal(calls.count.length, 0);
  assert.equal(calls.update.length, 1);
});

test("a conflicting listing state (already submitted, deleted, etc.) reports CONFLICT, distinct from LIMIT_REACHED", async () => {
  const { t } = stubT({ count: { count: 0 }, updateResult: null });
  await withTxStub(t, async () => {
    const result = await submitWithinLimit({ id: "listing-1", userId: "user-1", organizationId: null, limit: 2 });
    assert.deepEqual(result, { submitted: null, reason: "CONFLICT" });
  });
});

// approveWithinLimit — Critical 2: submit-time enforcement alone lets a
// seller submit several listings while under the limit and have an admin
// approve them all later; this closes that gap by re-checking the same
// live count, under the same per-owner lock, at approval time too.

const stubApproveT = ({ count = null, updateResult = null }) => {
  const calls = { lock: [], count: [], update: [] };
  return {
    calls,
    t: {
      any: async (query, params) => {
        assert.match(query, /pg_advisory_xact_lock\(hashtext\(\$1::text\)\)/);
        calls.lock.push(params);
      },
      one: async (query, params) => {
        assert.match(query, /SELECT count\(\*\)::int AS count FROM marketplace\.listings/);
        calls.count.push(params);
        return count;
      },
      oneOrNone: async (query, params) => {
        assert.match(query, /UPDATE marketplace\.listings SET review_status = 'APPROVED'/);
        calls.update.push(params);
        return updateResult;
      }
    }
  };
};

test("approving under the owner's active-listing limit locks per-owner (the SAME lock key submitWithinLimit uses), counts, then approves, all in one transaction", async () => {
  const { t, calls } = stubApproveT({ count: { count: 1 }, updateResult: { id: "listing-1" } });
  await withTxStub(t, async () => {
    const result = await approveWithinLimit({
      id: "listing-1",
      userId: "user-1",
      organizationId: null,
      limit: 2,
      expiresAt: null
    });
    assert.deepEqual(result, { approved: { id: "listing-1" }, reason: null });
  });
  assert.deepEqual(calls.lock, [["ACTIVE_LISTINGS:user-1"]]);
  assert.deepEqual(calls.count, [["user-1"]]);
  assert.equal(calls.update.length, 1);
});

test("approving at the owner's active-listing limit is rejected, and the UPDATE is never attempted — even though the listing was already validly submitted", async () => {
  const { t, calls } = stubApproveT({ count: { count: 2 } });
  await withTxStub(t, async () => {
    const result = await approveWithinLimit({
      id: "listing-1",
      userId: "user-1",
      organizationId: null,
      limit: 2,
      expiresAt: null
    });
    assert.deepEqual(result, { approved: null, reason: "LIMIT_REACHED", used: 2 });
  });
  assert.equal(calls.update.length, 0);
});

test("an org-owned listing's approval locks and counts against the org's shared pool, not the individual admin or submitter", async () => {
  const { t, calls } = stubApproveT({ count: { count: 3 }, updateResult: { id: "listing-2" } });
  await withTxStub(t, async () => {
    await approveWithinLimit({ id: "listing-2", userId: "user-1", organizationId: "org-1", limit: 5, expiresAt: null });
  });
  assert.deepEqual(calls.lock, [["ACTIVE_LISTINGS:org-1"]]);
  assert.deepEqual(calls.count, [["org-1"]]);
});

test("approval limit: null (unlimited) skips the count query entirely and goes straight to the UPDATE", async () => {
  const { t, calls } = stubApproveT({ updateResult: { id: "listing-1" } });
  await withTxStub(t, async () => {
    await approveWithinLimit({ id: "listing-1", userId: "user-1", organizationId: null, limit: null, expiresAt: null });
  });
  assert.equal(calls.count.length, 0);
  assert.equal(calls.update.length, 1);
});

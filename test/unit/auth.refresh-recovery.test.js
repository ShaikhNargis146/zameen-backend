import assert from "node:assert/strict";
import test from "node:test";

import { pg } from "../../src/shared/db.js";
import * as authRepository from "../../src/modules/auth/auth.repository.js";

const withStub = async (method, stub, callback) => {
  const original = pg[method];
  pg[method] = stub;
  try {
    await callback();
  } finally {
    pg[method] = original;
  }
};

test("linkRotation records which session replaced a consumed one", async () => {
  await withStub(
    "none",
    async (query, params) => {
      assert.match(query, /UPDATE auth\.refresh_sessions SET replaced_by_session_id = \$2 WHERE id = \$1/);
      assert.deepEqual(params, ["old-session", "new-session"]);
      return { ok: true, data: null };
    },
    async () => {
      await authRepository.linkRotation("old-session", "new-session");
    }
  );
});

test("recoverableSuccessor only matches a recently-consumed session whose successor is still unused", async () => {
  await withStub(
    "oneOrNone",
    async (query, params) => {
      assert.match(query, /FROM auth\.refresh_sessions reused/);
      assert.match(query, /JOIN auth\.refresh_sessions successor ON successor\.id = reused\.replaced_by_session_id/);
      assert.match(query, /reused\.last_used_at > now\(\) - \(\$2 \|\| ' seconds'\)::interval/);
      assert.match(query, /successor\.revoked_at IS NULL/);
      assert.match(query, /successor\.expires_at > now\(\)/);
      assert.deepEqual(params, ["old-session", 15]);
      return { ok: true, data: { id: "new-session", userId: "user-1", familyId: "family-1" } };
    },
    async () => {
      const successor = await authRepository.recoverableSuccessor("old-session", 15);
      assert.equal(successor.id, "new-session");
      assert.equal(successor.familyId, "family-1");
    }
  );
});

test("refreshSessionByHash reads the rotation-chain fields needed for recovery", async () => {
  await withStub(
    "oneOrNone",
    async query => {
      assert.match(query, /last_used_at, replaced_by_session_id/);
      return { ok: true, data: null };
    },
    async () => {
      await authRepository.refreshSessionByHash("hash");
    }
  );
});

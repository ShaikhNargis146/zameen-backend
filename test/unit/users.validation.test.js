import assert from "node:assert/strict";
import test from "node:test";
import { selfRole } from "../../src/modules/users/users.validation.js";

test("a verified user can select any non-admin onboarding role", () => {
  for (const roleCode of [
    "BUYER",
    "SELLER",
    "BROKER",
    "DEVELOPER",
    "CHANNEL_PARTNER",
    "CORPORATE"
  ])
    assert.equal(selfRole({ roleCode: roleCode.toLowerCase() }), roleCode);
});

test("the legacy role field remains supported and ADMIN cannot be self-assigned", () => {
  assert.equal(selfRole({ role: "seller" }), "SELLER");
  assert.throws(
    () => selfRole({ roleCode: "ADMIN" }),
    error => error.code === "ROLE_NOT_SELF_ASSIGNABLE"
  );
});

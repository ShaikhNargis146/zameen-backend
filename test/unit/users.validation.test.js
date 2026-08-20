import assert from "node:assert/strict";
import test from "node:test";
import { selfRole } from "../../src/modules/users/users.validation.js";

test("a verified user can select buyer or seller roles", () => {
  for (const roleCode of ["BUYER", "SELLER"])
    assert.equal(selfRole({ roleCode: roleCode.toLowerCase() }), roleCode);
});

test("business and administrator roles cannot be self-assigned", () => {
  assert.equal(selfRole({ role: "seller" }), "SELLER");
  for (const roleCode of [
    "BROKER",
    "DEVELOPER",
    "CHANNEL_PARTNER",
    "CORPORATE",
    "ADMIN"
  ])
    assert.throws(
      () => selfRole({ roleCode }),
      error => error.code === "ROLE_NOT_SELF_ASSIGNABLE"
    );
});

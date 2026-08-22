import assert from "node:assert/strict";
import test from "node:test";
import { selfRole } from "../../src/modules/users/users.validation.js";

test("a verified user can select any non-administrator role in the API contract", () => {
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

test("administrator role cannot be self-assigned", () => {
  assert.equal(selfRole({ role: "seller" }), "SELLER");
  for (const roleCode of ["ADMIN", "UNKNOWN"])
    assert.throws(
      () => selfRole({ roleCode }),
      error => error.code === "ROLE_NOT_SELF_ASSIGNABLE"
    );
});

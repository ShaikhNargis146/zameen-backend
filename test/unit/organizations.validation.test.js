import assert from "node:assert/strict";
import test from "node:test";

import { addMember } from "../../src/modules/organizations/organizations.validation.js";

// addMember() is invite-by-phone only — there is no explicit-userId path.
// organizations.service.js#resolveInvitedUser creates the account if it
// doesn't exist yet, or reuses an existing one matched by phone number.

test("addMember() returns { role, invite: {...} }, trimming phone and uppercasing role", () => {
  const result = addMember({
    phone: " +919876543210 ",
    firstName: "  Jane ",
    lastName: " Doe ",
    role: "member"
  });
  assert.deepEqual(result, {
    role: "MEMBER",
    invite: {
      phone: "+919876543210",
      firstName: "Jane",
      lastName: "Doe"
    }
  });
});

test("addMember() rejects OWNER — there is no way to grant ownership through this endpoint", () => {
  assert.throws(
    () => addMember({ phone: "+919876543210", firstName: "Jane", lastName: "Doe", role: "OWNER" }),
    error => error.code === "INVALID_ROLE" && /ADMIN or MEMBER/.test(error.message)
  );
});

test("addMember() rejects any role outside ADMIN/MEMBER", () => {
  assert.throws(
    () => addMember({ phone: "+919876543210", firstName: "Jane", lastName: "Doe", role: "SUPERUSER" }),
    error => error.code === "INVALID_ROLE"
  );
});

test("addMember() rejects a malformed phone number", () => {
  assert.throws(
    () => addMember({ phone: "not-a-phone", firstName: "Jane", lastName: "Doe", role: "MEMBER" }),
    error => error.code === "INVALID_PHONE"
  );
});

test("addMember() requires both firstName and lastName", () => {
  assert.throws(
    () => addMember({ phone: "+919876543210", firstName: "", lastName: "Doe", role: "MEMBER" }),
    error => error.code === "INVALID_FIRST_NAME"
  );
  assert.throws(
    () => addMember({ phone: "+919876543210", firstName: "Jane", lastName: "", role: "MEMBER" }),
    error => error.code === "INVALID_LAST_NAME"
  );
});

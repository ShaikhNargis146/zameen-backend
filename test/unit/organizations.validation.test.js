import assert from "node:assert/strict";
import test from "node:test";

import { addMember } from "../../src/modules/organizations/organizations.validation.js";

// addMember() is invite-by-email only — there is no explicit-userId path.
// organizations.service.js#resolveInvitedUser creates the account if it
// doesn't exist yet, or reuses an existing one matched by email.

test("addMember() returns { role, invite: {...} }, lowercasing email and uppercasing role", () => {
  const result = addMember({
    email: "New.Hire@Example.com",
    firstName: "  Jane ",
    lastName: " Doe ",
    role: "member"
  });
  assert.deepEqual(result, {
    role: "MEMBER",
    invite: {
      email: "new.hire@example.com",
      firstName: "Jane",
      lastName: "Doe"
    }
  });
});

test("addMember() rejects OWNER — there is no way to grant ownership through this endpoint", () => {
  assert.throws(
    () => addMember({ email: "new.hire@example.com", firstName: "Jane", lastName: "Doe", role: "OWNER" }),
    error => error.code === "INVALID_ROLE" && /ADMIN or MEMBER/.test(error.message)
  );
});

test("addMember() rejects any role outside ADMIN/MEMBER", () => {
  assert.throws(
    () => addMember({ email: "new.hire@example.com", firstName: "Jane", lastName: "Doe", role: "SUPERUSER" }),
    error => error.code === "INVALID_ROLE"
  );
});

test("addMember() rejects a malformed email", () => {
  assert.throws(
    () => addMember({ email: "not-an-email", firstName: "Jane", lastName: "Doe", role: "MEMBER" }),
    error => error.code === "INVALID_EMAIL"
  );
});

test("addMember() requires both firstName and lastName", () => {
  assert.throws(
    () => addMember({ email: "new.hire@example.com", firstName: "", lastName: "Doe", role: "MEMBER" }),
    error => error.code === "INVALID_FIRST_NAME"
  );
  assert.throws(
    () => addMember({ email: "new.hire@example.com", firstName: "Jane", lastName: "", role: "MEMBER" }),
    error => error.code === "INVALID_LAST_NAME"
  );
});

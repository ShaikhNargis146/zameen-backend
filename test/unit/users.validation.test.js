import assert from "node:assert/strict";
import test from "node:test";
import {
  emailChangeConfirm,
  emailChangeRequest,
  profileChanges,
  selfRole
} from "../../src/modules/users/users.validation.js";

test("profile changes reject a direct email change — it must go through the verified OTP flow", () => {
  assert.throws(
    () => profileChanges({ email: "new@example.com" }),
    error => error.code === "EMAIL_CHANGE_REQUIRES_VERIFICATION"
  );
});

test("profile changes still accept other editable fields with no email present", () => {
  assert.deepEqual(profileChanges({ displayName: "Jane Doe" }), {
    display_name: "Jane Doe"
  });
});

test("email change request validates the new address", () => {
  assert.deepEqual(emailChangeRequest({ email: "New@Example.com" }), {
    email: "new@example.com"
  });
  assert.throws(
    () => emailChangeRequest({ email: "not-an-email" }),
    error => error.code === "INVALID_EMAIL"
  );
  assert.throws(
    () => emailChangeRequest({}),
    error => error.code === "INVALID_EMAIL"
  );
});

test("email change confirm requires both challengeId and otp", () => {
  assert.deepEqual(emailChangeConfirm({ challengeId: "abc", otp: "123456" }), {
    challengeId: "abc",
    otp: "123456"
  });
  for (const body of [{}, { challengeId: "abc" }, { otp: "123456" }])
    assert.throws(
      () => emailChangeConfirm(body),
      error => error.code === "INVALID_OTP"
    );
});

test("a verified user can select self-service roles in the API contract", () => {
  for (const roleCode of [
    "BUYER",
    "SELLER",
    "BROKER",
    "DEVELOPER",
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

test("channel partner role remains controlled by the approval workflow", () => {
  assert.throws(
    () => selfRole({ roleCode: "CHANNEL_PARTNER" }),
    error => error.code === "ROLE_NOT_SELF_ASSIGNABLE"
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { otpRequest } from "../../src/modules/auth/auth.validation.js";

test("OTP requests require a valid channel, purpose, and destination", () => {
  assert.deepEqual(
    otpRequest({
      destination: "9876543210",
      countryCode: "+91",
      channel: "SMS",
      purpose: "login"
    }),
    { phone: "+919876543210", email: undefined, purpose: "LOGIN" }
  );
  assert.throws(
    () => otpRequest({ destination: "person@example.com", purpose: "LOGIN" }),
    error => error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => otpRequest({ destination: "not-an-email", channel: "EMAIL", purpose: "LOGIN" }),
    error => error.code === "VALIDATION_ERROR"
  );
});

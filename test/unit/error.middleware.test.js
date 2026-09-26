import assert from "node:assert/strict";
import test from "node:test";
import error from "../../src/middlewares/error.js";
import { HttpError } from "../../src/shared/http.js";

const response = () => ({
  headersSent: false,
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  }
});

test("production errors never expose raw database messages", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const res = response();
  error.handler(
    {
      status: 500,
      code: "23505",
      message: "duplicate key value violates unique constraint"
    },
    {},
    res
  );
  process.env.NODE_ENV = original;
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Internal Server Error" }
  });
});

test("safe provider configuration errors remain actionable in production", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const res = response();
  error.handler(
    {
      status: 503,
      code: "AI_PROVIDER_UNCONFIGURED",
      message: "AI service is unavailable."
    },
    {},
    res
  );
  process.env.NODE_ENV = original;
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "AI_PROVIDER_UNCONFIGURED",
      message: "AI service is unavailable."
    }
  });
});

test("all reviewed AI service errors remain actionable in production", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const res = response();
  error.handler(
    {
      status: 503,
      code: "AI_PROVIDER_INCOMPLETE",
      message: "AI response was interrupted. Please try again."
    },
    {},
    res
  );
  process.env.NODE_ENV = original;
  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "AI_PROVIDER_INCOMPLETE",
      message: "AI response was interrupted. Please try again."
    }
  });
});

test("safe storage availability errors remain actionable in production", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const res = response();
  error.handler(
    {
      status: 503,
      code: "STORAGE_UNAVAILABLE",
      message: "File storage is temporarily unavailable."
    },
    {},
    res
  );
  process.env.NODE_ENV = original;
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "STORAGE_UNAVAILABLE",
      message: "File storage is temporarily unavailable."
    }
  });
});

test("a plain-object details payload (entitlement errors) is surfaced, not silently dropped", () => {
  const res = response();
  error.handler(
    {
      status: 403,
      code: "PLAN_LIMIT_REACHED",
      message: "This plan allows up to 2 active listings.",
      details: { feature: "ACTIVE_LISTINGS", used: 2, limit: 2, upgradeRequired: true }
    },
    {},
    res
  );
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "PLAN_LIMIT_REACHED",
      message: "This plan allows up to 2 active listings.",
      details: { feature: "ACTIVE_LISTINGS", used: 2, limit: 2, upgradeRequired: true }
    }
  });
});

test("an empty details object is not surfaced", () => {
  const res = response();
  error.handler({ status: 400, code: "VALIDATION_ERROR", message: "Invalid input.", details: {} }, {}, res);
  assert.deepEqual(res.body, {
    success: false,
    error: { code: "VALIDATION_ERROR", message: "Invalid input." }
  });
});

test("converter retains reviewed service-error messages", () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const res = response();
  error.converter(
    new HttpError(
      503,
      "STORAGE_UNAVAILABLE",
      "File storage is temporarily unavailable."
    ),
    {},
    res
  );
  process.env.NODE_ENV = original;
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "STORAGE_UNAVAILABLE",
      message: "File storage is temporarily unavailable."
    }
  });
});

test("converter carries an HttpError's object details through end to end (asyncRoute's actual path)", () => {
  const res = response();
  error.converter(
    new HttpError(403, "PLAN_LIMIT_REACHED", "This plan allows up to 2 active listings.", {
      feature: "ACTIVE_LISTINGS",
      used: 2,
      limit: 2,
      upgradeRequired: true
    }),
    {},
    res
  );
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, {
    success: false,
    error: {
      code: "PLAN_LIMIT_REACHED",
      message: "This plan allows up to 2 active listings.",
      details: { feature: "ACTIVE_LISTINGS", used: 2, limit: 2, upgradeRequired: true }
    }
  });
});

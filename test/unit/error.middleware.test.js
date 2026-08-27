import assert from "node:assert/strict";
import test from "node:test";
import error from "../../src/middlewares/error.js";

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

import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeListingDraft,
  providerErrorMetadata
} from "../../src/modules/ai/ai.provider.js";

test("listing drafts are normalized to the UI contract limits", () => {
  const result = normalizeListingDraft({
    title: "  Industrial land in Panvel  ",
    description: "  Near the highway with road access.  ",
    highlights: [" Corner plot ", "", "  Road-facing  "]
  });
  assert.deepEqual(result, {
    title: "Industrial land in Panvel",
    description: "Near the highway with road access.",
    highlights: ["Corner plot", "Road-facing"]
  });
});

test("listing drafts reject unusable model output", () => {
  assert.throws(
    () => normalizeListingDraft({ title: "", description: "Draft" }),
    error => error.code === "AI_PROVIDER_INVALID_RESPONSE"
  );
});

test("provider diagnostics exclude provider messages and sanitize log fields", () => {
  assert.deepEqual(
    providerErrorMetadata({
      name: "AuthenticationError",
      status: 401,
      code: "invalid_api_key",
      type: "invalid_request_error",
      request_id: "req_123",
      message: "This must never be logged"
    }),
    {
      name: "AuthenticationError",
      status: 401,
      code: "invalid_api_key",
      type: "invalid_request_error",
      requestId: "req_123"
    }
  );
});

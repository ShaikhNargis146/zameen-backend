import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AI_FALLBACK_MODEL,
  DEFAULT_AI_MODEL,
  isRetryableProviderFailure,
  normalizeListingDraft,
  providerErrorMetadata,
  responseReasoningFor,
  streamedTextDelta,
  streamedTextDone,
  withModelFallback
} from "../../src/modules/ai/ai.provider.js";
import {
  storageErrorMetadata,
  storageUnavailable
} from "../../src/utils/storage.js";
import { HttpError } from "../../src/shared/http.js";

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

test("storage diagnostics exclude provider messages and sanitize log fields", () => {
  assert.deepEqual(
    storageErrorMetadata({
      name: "FetchError",
      code: "ECONNRESET",
      message: "This must never be logged"
    }),
    { name: "FetchError", code: "ECONNRESET", status: "none" }
  );
  const original = new HttpError(
    503,
    "STORAGE_UNAVAILABLE",
    "File storage is temporarily unavailable."
  );
  assert.equal(storageUnavailable(original), original);
});

test("only supported OpenAI text events become chat stream deltas", () => {
  assert.equal(
    streamedTextDelta({ type: "response.output_text.delta", delta: "Hello" }),
    "Hello"
  );
  assert.equal(
    streamedTextDelta({ type: "response.refusal.delta", delta: "Sorry" }),
    "Sorry"
  );
  assert.equal(
    streamedTextDelta({ type: "response.completed", delta: "ignored" }),
    null
  );
});

test("completed OpenAI text is available only as a stream fallback", () => {
  assert.equal(
    streamedTextDone({ type: "response.output_text.done", text: "Hello" }),
    "Hello"
  );
  assert.equal(
    streamedTextDone({ type: "response.completed", text: "ignored" }),
    null
  );
});

test("AI defaults use Luna without reasoning and retain the requested fallback", () => {
  assert.equal(DEFAULT_AI_MODEL, "gpt-6-luna");
  assert.equal(DEFAULT_AI_FALLBACK_MODEL, "gpt-5-mini");
  assert.deepEqual(responseReasoningFor(DEFAULT_AI_MODEL), {
    reasoning: { effort: "none" }
  });
  assert.deepEqual(responseReasoningFor(DEFAULT_AI_FALLBACK_MODEL), {
    reasoning: { effort: "minimal" }
  });
});

test("model fallback retries only a retryable primary-model failure", async () => {
  const attemptedModels = [];
  const result = await withModelFallback({
    primaryModel: "gpt-6-luna",
    fallbackModel: "gpt-5-mini",
    execute: async selectedModel => {
      attemptedModels.push(selectedModel);
      if (selectedModel === "gpt-6-luna") {
        const error = new Error("rate limited");
        error.status = 429;
        throw error;
      }
      return "fallback response";
    }
  });
  assert.equal(result, "fallback response");
  assert.deepEqual(attemptedModels, ["gpt-6-luna", "gpt-5-mini"]);
  assert.equal(isRetryableProviderFailure({ status: 429 }), true);
  assert.equal(isRetryableProviderFailure({ status: 400 }), false);
  assert.equal(isRetryableProviderFailure({ name: "AbortError" }), false);
});

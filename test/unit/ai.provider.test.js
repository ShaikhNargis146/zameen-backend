import assert from "node:assert/strict";
import test from "node:test";
import { normalizeListingDraft } from "../../src/modules/ai/ai.provider.js";

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

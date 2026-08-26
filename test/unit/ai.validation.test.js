import assert from "node:assert/strict";
import test from "node:test";
import {
  conversation,
  conversationList,
  listingGenerate,
  search
} from "../../src/modules/ai/ai.validation.js";

const listingId = "11111111-1111-1111-1111-111111111111";

test("AI search applies contract limits", () => {
  const result = search({ query: "find verified land", page: 0, limit: 100 });
  assert.equal(result.page, 1);
  assert.equal(result.limit, 50);
});

test("property AI conversations require a listing context", () => {
  assert.throws(
    () => conversation({ contextType: "PROPERTY" }),
    error => error.code === "LISTING_REQUIRED"
  );
  assert.deepEqual(conversation({ contextType: "PROPERTY", listingId }), {
    contextType: "PROPERTY",
    listingId,
    initialQuery: null
  });
});

test("AI conversation history uses bounded pagination", () => {
  assert.deepEqual(conversationList({ page: "2", limit: "100" }), {
    page: 2,
    limit: 50,
    offset: 50
  });
});

test("listing generator accepts at most ten non-empty highlights", () => {
  const result = listingGenerate({ highlights: ["Corner plot"] });
  assert.deepEqual(result.highlights, ["Corner plot"]);
  assert.throws(
    () => listingGenerate({ highlights: Array.from({ length: 11 }, () => "x") }),
    error => error.code === "VALIDATION_ERROR"
  );
});

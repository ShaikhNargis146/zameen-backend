import assert from "node:assert/strict";
import test from "node:test";
import { sellerList } from "../../src/modules/listings/listings.validation.js";

test("seller listing query supports page, review status and search", () => {
  const result = sellerList({
    page: 3,
    limit: 10,
    status: "published",
    reviewStatus: "approved",
    search: "industrial"
  });
  assert.equal(result.offset, 20);
  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.reviewStatus, "APPROVED");
  assert.equal(result.search, "industrial");
});

test("seller listing query rejects unknown review statuses", () => {
  assert.throws(
    () => sellerList({ reviewStatus: "unknown" }),
    error => error.code === "VALIDATION_ERROR"
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  approval,
  create,
  sellerList
} from "../../src/modules/listings/listings.validation.js";

test("listing creation enforces the published UI contract", () => {
  const listing = create({
    transactionType: "sale",
    title: "Corner industrial land parcel",
    description: "Well located industrial land parcel with direct road access.",
    priceAmountMinor: 100000000,
    isNegotiable: false
  });
  assert.equal(listing.transactionType, "SALE");
  assert.equal(listing.currency, "INR");
  assert.throws(
    () => create({ title: "Too short", description: "short", priceAmountMinor: 1 }),
    error => error.code === "VALIDATION_ERROR"
  );
});

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

test("listing approval accepts only future expiry timestamps", () => {
  const expiry = new Date(Date.now() + 60000).toISOString();
  assert.equal(approval({ expiresAt: expiry, note: "Reviewed" }).expiresAt.toISOString(), expiry);
  assert.throws(
    () => approval({ expiresAt: "2020-01-01T00:00:00.000Z" }),
    error => error.code === "VALIDATION_ERROR"
  );
});

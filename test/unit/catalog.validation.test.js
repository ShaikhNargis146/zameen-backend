import assert from "node:assert/strict";
import test from "node:test";
import { locationSearch } from "../../src/modules/catalog/catalog.validation.js";

test("location search treats an empty types filter as unfiltered", () => {
  const result = locationSearch({ q: "Panvel", types: ", ," });
  assert.equal(result.q, "Panvel");
  assert.equal(result.types, null);
});

test("location search requires a meaningful query", () => {
  assert.throws(
    () => locationSearch({ q: "x" }),
    error => error.code === "VALIDATION_ERROR"
  );
});

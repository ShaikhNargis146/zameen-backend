import assert from "node:assert/strict";
import test from "node:test";
import {
  compare,
  map,
  search
} from "../../src/modules/discovery/discovery.validation.js";

const unitId = "11111111-1111-1111-1111-111111111111";
const listingIds = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222"
];

test("discovery search normalizes safe filter input and pagination", () => {
  const result = search({
    transactionTypes: ["sale"],
    minArea: 1,
    areaUnitId: unitId,
    verifiedOnly: "true",
    sort: "price_asc",
    page: 2,
    limit: 10
  });
  assert.deepEqual(result.transactionTypes, ["SALE"]);
  assert.equal(result.verifiedOnly, true);
  assert.equal(result.sort, "PRICE_ASC");
  assert.equal(result.offset, 10);
});

test("discovery search requires an area unit whenever area is filtered", () => {
  assert.throws(
    () => search({ minArea: 2 }),
    error => error.code === "AREA_UNIT_REQUIRED"
  );
});

test("map search validates bounds and compare requires unique listing ids", () => {
  const result = map({
    bounds: { north: 19.2, south: 18.9, east: 73.2, west: 72.9 },
    maxPins: 20
  });
  assert.equal(result.maxPins, 20);
  assert.deepEqual(compare({ listingIds }), listingIds);
  assert.throws(
    () => compare({ listingIds: [listingIds[0], listingIds[0]] }),
    error => error.code === "VALIDATION_ERROR"
  );
});

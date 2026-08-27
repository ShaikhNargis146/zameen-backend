import assert from "node:assert/strict";
import test from "node:test";
import {
  lgdSlug,
  locationTypes,
  stateCodeForLgd
} from "../../src/modules/catalog/location-import.constants.js";

test("LGD state codes map to the API state-code contract", () => {
  assert.equal(stateCodeForLgd("27"), "MH");
  assert.equal(stateCodeForLgd("38"), "DH");
  assert.equal(stateCodeForLgd("999"), undefined);
});

test("LGD location identities are deterministic and type-scoped", () => {
  assert.equal(lgdSlug(locationTypes.states, "27"), "lgd-state-27");
  assert.equal(lgdSlug(locationTypes.districts, "27"), "lgd-district-27");
});

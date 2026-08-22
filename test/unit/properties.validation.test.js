import assert from "node:assert/strict";
import test from "node:test";
import {
  landDetails,
  verificationRequest
} from "../../src/modules/properties/properties.validation.js";

test("property boolean fields do not treat the string false as true", () => {
  const details = landDetails({
    areaValue: 1,
    areaUnitId: "unit-1",
    isCornerPlot: "false",
    hasBoundaryWall: "false"
  });
  assert.equal(details.isCornerPlot, false);
  assert.equal(details.hasBoundaryWall, false);
});

test("land details accept the compact facing values from the UI contract", () => {
  const details = landDetails({
    areaValue: 1,
    areaUnitId: "unit-1",
    dimensionUnit: "M",
    facing: "NE",
    roadType: "OTHER",
    roadAccessType: "NO_DIRECT",
    terrain: "UNEVEN"
  });
  assert.equal(details.facing, "NE");
  assert.equal(details.dimensionUnit, "M");
  assert.equal(details.roadType, "OTHER");
  assert.throws(
    () => landDetails({ areaValue: 1, areaUnitId: "unit-1", facing: "UP" }),
    error => error.code === "VALIDATION_ERROR"
  );
});

test("verification requests accept an optional note and reject malformed check types", () => {
  assert.deepEqual(verificationRequest({ note: "Please verify access road." }), {
    checkTypes: [
      "LOCATION",
      "LAND_DETAILS",
      "PARCEL_IDENTITY",
      "DOCUMENTS",
      "SITE_VISIT"
    ],
    note: "Please verify access road."
  });
  assert.throws(
    () => verificationRequest({ checkTypes: "LOCATION" }),
    error => error.code === "VALIDATION_ERROR"
  );
});

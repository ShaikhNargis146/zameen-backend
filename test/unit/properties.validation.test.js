import assert from "node:assert/strict";
import test from "node:test";
import {
  documentComplete,
  landDetails,
  mediaUpload,
  propertyList,
  propertyLocation,
  updateProperty,
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

test("land details accept zero-width normalized measurements", () => {
  const result = landDetails({
    areaValue: 1,
    areaUnitId: "11111111-1111-1111-1111-111111111111",
    frontageM: 0,
    roadWidthM: 0
  });
  assert.equal(result.frontageM, 0);
  assert.equal(result.roadWidthM, 0);
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

test("property location input enforces the UI contract bounds and lengths", () => {
  const validLocation = {
    locationId: "11111111-1111-1111-1111-111111111111",
    latitude: 19.076,
    longitude: 72.8777,
    pincode: "400001",
    locationPrecision: "APPROXIMATE"
  };
  assert.equal(propertyLocation(validLocation).locationPrecision, "APPROXIMATE");
  for (const changes of [
    { latitude: 91 },
    { longitude: 181 },
    { pincode: "40001" },
    { locationPrecision: "ESTIMATED" },
    { addressLine: "x".repeat(501) },
    { landmark: "x".repeat(256) }
  ])
    assert.throws(
      () => propertyLocation({ ...validLocation, ...changes }),
      error =>
        ["VALIDATION_ERROR", "INVALID_COORDINATES", "INVALID_PINCODE"].includes(
          error.code
        )
    );
});

test("property lists reject malformed pagination and contract-overlong search", () => {
  assert.deepEqual(propertyList({ page: "2", limit: "10" }), {
    page: 2,
    limit: 10,
    status: null,
    search: null
  });
  assert.throws(() => propertyList({ page: "not-a-page" }));
  assert.throws(() => propertyList({ search: "x".repeat(201) }));
  assert.throws(() => updateProperty({ status: "ARCHIVED" }));
});

test("property upload inputs accept only the documented MIME policy", () => {
  assert.equal(
    mediaUpload({
      fileName: "front.webp",
      mimeType: "image/webp",
      fileSizeBytes: 1,
      mediaType: "IMAGE"
    }).mimeType,
    "image/webp"
  );
  assert.throws(() =>
    mediaUpload({
      fileName: "x".repeat(256),
      mimeType: "image/jpeg",
      fileSizeBytes: 1,
      mediaType: "IMAGE"
    })
  );
  assert.throws(() =>
    mediaUpload({
      fileName: "unsafe.html",
      mimeType: "text/html",
      fileSizeBytes: 1,
      mediaType: "IMAGE"
    })
  );
  assert.throws(() =>
    documentComplete({
      storageKey: "properties/id/documents/file.pdf",
      documentTypeId: "not-a-uuid",
      fileName: "file.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 1
    })
  );
});

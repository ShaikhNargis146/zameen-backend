import assert from "node:assert/strict";
import test from "node:test";

import { verificationSummaryForChecks } from "../../src/shared/verification.js";
import {
  canReviewVerification,
  verificationQueuePresentation
} from "../../src/modules/verification/verification.service.js";
import { update } from "../../src/modules/verification/verification.validation.js";

test("verification summaries expose status but not admin action IDs", () => {
  const checks = [
    { id: "document-check-id", checkType: "DOCUMENTS", status: "VERIFIED" },
    { id: "land-check-id", checkType: "LAND_DETAILS", status: "PENDING" }
  ];

  const result = verificationSummaryForChecks("property-id", checks);
  assert.deepEqual(result.checks, [
    {
      checkType: "DOCUMENTS",
      status: "VERIFIED",
      reviewedAt: null,
      publicNote: null,
      updatedAt: null
    },
    {
      checkType: "LAND_DETAILS",
      status: "PENDING",
      reviewedAt: null,
      publicNote: null,
      updatedAt: null
    }
  ]);
});

test("admin verification lists expose one unambiguous type-specific check per row", () => {
  const rows = [
    {
      id: "document-check-id",
      propertyId: "property-id",
      propertyCode: "ZMN-P-TEST",
      checkType: "DOCUMENTS",
      status: "VERIFIED",
      total: 2
    },
    {
      id: "land-check-id",
      propertyId: "property-id",
      propertyCode: "ZMN-P-TEST",
      checkType: "LAND_DETAILS",
      status: "PENDING",
      total: 2
    }
  ];

  const result = verificationQueuePresentation(rows);
  assert.equal(result.length, 2);
  assert.deepEqual(result[1], {
    id: "land-check-id",
    checkType: "LAND_DETAILS",
    status: "PENDING",
    requestedAt: undefined,
    reviewedAt: undefined,
    publicNote: undefined,
    property: { id: "property-id", publicCode: "ZMN-P-TEST" }
  });
});

test("verification updates derive the type from the verification ID", () => {
  assert.deepEqual(update({ status: "VERIFIED", publicNote: "Reviewed." }), {
    checkType: null,
    status: "VERIFIED",
    publicNote: "Reviewed.",
    internalNote: null
  });
  assert.throws(
    () => update({ status: "NOT_STARTED" }),
    error => error.code === "VALIDATION_ERROR"
  );
  assert.equal(canReviewVerification("PENDING"), true);
  assert.equal(canReviewVerification("NOT_STARTED"), false);
  assert.equal(canReviewVerification("VERIFIED"), false);
});

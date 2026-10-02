import assert from "node:assert/strict";
import test from "node:test";

import { verificationSummaryForChecks } from "../../src/shared/verification.js";

test("verification summaries retain the type-specific check IDs", () => {
  const checks = [
    { id: "document-check-id", checkType: "DOCUMENTS", status: "VERIFIED" },
    { id: "land-check-id", checkType: "LAND_DETAILS", status: "PENDING" }
  ];

  const result = verificationSummaryForChecks("property-id", checks);
  assert.equal(result.checks[0].id, "document-check-id");
  assert.equal(result.checks[1].id, "land-check-id");
});

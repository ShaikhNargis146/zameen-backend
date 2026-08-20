import assert from "node:assert/strict";
import test from "node:test";
import { scannerPresentation } from "../../src/shared/scanner.js";

test("Scanner Lite always returns all weighted sections", () => {
  const scanner = scannerPresentation({
    propertyId: "property-id",
    readinessScore: 55,
    missingItems: ["Property document", "Property media"]
  });
  assert.equal(scanner.sections.length, 5);
  assert.equal(scanner.sections.reduce((sum, section) => sum + section.maxScore, 0), 100);
  assert.deepEqual(
    scanner.sections.find(section => section.key === "documents"),
    {
      key: "documents",
      label: "Property documents",
      score: 0,
      maxScore: 20,
      status: "MISSING"
    }
  );
  assert.equal(scanner.missingItems[0].severity, "HIGH");
});

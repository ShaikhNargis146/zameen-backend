import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  lgdSlug,
  locationTypes,
  normalizeLocationLabel,
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

test("postal labels are matched without case, punctuation, or accents", () => {
  assert.equal(normalizeLocationLabel("Dadra & Nagar Havéli"), "DADRANAGARHAVELI");
});

test("PIN-only preparation does not require LGD workbooks", async () => {
  const [script, requirements] = await Promise.all([
    readFile(
      new URL("../../scripts/prepare-location-data.py", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../../scripts/requirements-location-import.txt", import.meta.url),
      "utf8"
    )
  ]);
  assert.match(script, /--only-pincodes/);
  assert.match(script, /if not args\.only_pincodes:/);
  assert.match(requirements, /^openpyxl>=3\.1,<4\s*$/);
});

test("LGD refreshes preserve locations disabled by operations", async () => {
  const importer = await readFile(
    new URL("../../scripts/import-locations.js", import.meta.url),
    "utf8"
  );
  const update = importer.match(/UPDATE geo\.locations location[\s\S]*?\[payload, type\]/)?.[0];
  assert.ok(update);
  assert.doesNotMatch(update, /is_active\s*=\s*true/);
});

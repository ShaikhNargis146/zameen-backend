import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stateCode } from "../../src/modules/catalog/catalog.validation.js";
import { masters } from "../../src/modules/catalog/catalog.repository.js";

test("catalog state codes are normalized for state-aware master queries", () => {
  assert.equal(stateCode(" mh "), "MH");
  assert.equal(Object.hasOwn(masters, "road-types"), false);
});

test("the fresh schema defines recently viewed only once", async () => {
  const schema = await readFile(
    new URL("../../src/database/schema.sql", import.meta.url),
    "utf8"
  );
  const definitions = schema.match(
    /CREATE TABLE marketplace\.recently_viewed/g
  );
  assert.equal(definitions?.length, 1);
  assert.match(schema, /uq_land_document_types_global/);
  assert.match(schema, /uq_land_document_types_state/);
});

test("land-detail migration removes the old facing constraint before backfill", async () => {
  const migration = await readFile(
    new URL(
      "../../migrations/20260826_013_land_detail_contract_alignment.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.ok(
    migration.indexOf("DROP CONSTRAINT IF EXISTS property_land_details_facing_check") <
      migration.indexOf("UPDATE land.property_land_details\nSET facing")
  );
  assert.match(migration, /information_schema\.columns/);
  assert.match(migration, /ALTER COLUMN facing TYPE varchar\(2\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { masters } from "../../src/modules/catalog/catalog.constants.js";
import { stateCode } from "../../src/modules/catalog/catalog.validation.js";

test("catalog state codes are normalized for state-aware master queries", () => {
  assert.equal(stateCode(" mh "), "MH");
});

test("catalog exposes only documented master endpoints", () => {
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
});

test("the schema supports state-scoped document types", async () => {
  const schema = await readFile(
    new URL("../../src/database/schema.sql", import.meta.url),
    "utf8"
  );
  assert.match(schema, /uq_land_document_types_global/);
  assert.match(schema, /uq_land_document_types_state/);
  assert.match(
    schema,
    /ON CONFLICT \(code\) WHERE state_location_id IS NULL DO NOTHING/
  );
});

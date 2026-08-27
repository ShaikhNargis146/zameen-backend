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

test("location search uses indexable name and alias candidate queries", async () => {
  const [repository, schema] = await Promise.all([
    readFile(
      new URL("../../src/modules/catalog/catalog.repository.js", import.meta.url),
      "utf8"
    ),
    readFile(new URL("../../src/database/schema.sql", import.meta.url), "utf8")
  ]);
  assert.match(repository, /WITH candidates AS MATERIALIZED/);
  assert.match(repository, /lower\(l\.name\) LIKE/);
  assert.match(schema, /idx_geo_locations_name_prefix/);
});

test("hierarchy endpoints preserve LGD sub-district and village types as fallbacks", async () => {
  const [repository, routes] = await Promise.all([
    readFile(
      new URL("../../src/modules/catalog/catalog.repository.js", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../../src/modules/catalog/catalog.routes.js", import.meta.url),
      "utf8"
    )
  ]);
  assert.match(repository, /citiesForDistrict/);
  assert.match(repository, /l\.type = 'SUBDISTRICT'/);
  assert.match(repository, /localitiesForCity/);
  assert.match(repository, /l\.type = 'VILLAGE'/);
  assert.match(routes, /asyncRoute\(controller\.cities\)/);
  assert.match(routes, /asyncRoute\(controller\.localities\)/);
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
  assert.match(schema, /INSERT INTO land\.document_types[\s\S]*ON CONFLICT DO NOTHING;/);
});

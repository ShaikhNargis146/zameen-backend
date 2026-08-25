import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { stateCode } from "../../src/modules/catalog/catalog.validation.js";

test("catalog state codes are normalized for state-aware master queries", () => {
  assert.equal(stateCode(" mh "), "MH");
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

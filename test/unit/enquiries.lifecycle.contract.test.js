import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("revealing seller contact info links the buyer's earlier unlinked site visits", async () => {
  const service = await readFile(
    new URL("../../src/modules/enquiries/enquiries.service.js", import.meta.url),
    "utf8"
  );
  const contactReveal = service.slice(service.indexOf("export const contactReveal"));
  assert.match(contactReveal, /repository\.insertAndLinkUnlinkedVisits\(/);
  assert.doesNotMatch(contactReveal, /repository\.insert\(/);
});

test("enquiries repository no longer exposes an insert that bypasses visit linking", async () => {
  const repository = await import(
    "../../src/modules/enquiries/enquiries.repository.js"
  );
  assert.equal(repository.insert, undefined);
  assert.equal(typeof repository.insertAndLinkUnlinkedVisits, "function");
});

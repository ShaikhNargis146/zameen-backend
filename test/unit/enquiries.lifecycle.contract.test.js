import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("revealing seller contact info links the buyer's earlier unlinked site visits, atomically, without racing a duplicate enquiry into existence", async () => {
  const service = await readFile(
    new URL("../../src/modules/enquiries/enquiries.service.js", import.meta.url),
    "utf8"
  );
  const contactReveal = service.slice(service.indexOf("export const contactReveal"));
  assert.match(contactReveal, /repository\.findOrCreateEnquiryForContactReveal\(/);
  assert.doesNotMatch(contactReveal, /repository\.insert\(/);
});

test("revealing contact goes through the plan's contact-unlock allowance before any enquiry/lead is created", async () => {
  const service = await readFile(
    new URL("../../src/modules/enquiries/enquiries.service.js", import.meta.url),
    "utf8"
  );
  const contactReveal = service.slice(service.indexOf("export const contactReveal"));
  assert.match(contactReveal, /entitlements\.consumeContactUnlock\(/);
  assert.ok(
    contactReveal.indexOf("entitlements.consumeContactUnlock(") <
      contactReveal.indexOf("findOrCreateEnquiryForContactReveal("),
    "the plan-limit check must run before the enquiry/lead is created, so a PLAN_LIMIT_REACHED rejection leaves no side effect"
  );
});

test("a seller cannot enquire on or contact-reveal their own listing", async () => {
  const service = await readFile(
    new URL("../../src/modules/enquiries/enquiries.service.js", import.meta.url),
    "utf8"
  );
  const create = service.slice(
    service.indexOf("export const create"),
    service.indexOf("export const listForBuyer")
  );
  const contactReveal = service.slice(service.indexOf("export const contactReveal"));
  assert.match(create, /repository\.listingOwnedBySeller\(/);
  assert.match(create, /CANNOT_ENQUIRE_OWN_LISTING/);
  assert.match(contactReveal, /repository\.listingOwnedBySeller\(/);
  assert.match(contactReveal, /CANNOT_ENQUIRE_OWN_LISTING/);
});

test("enquiries repository no longer exposes an insert that bypasses visit linking", async () => {
  const repository = await import(
    "../../src/modules/enquiries/enquiries.repository.js"
  );
  assert.equal(repository.insert, undefined);
  assert.equal(typeof repository.insertAndLinkUnlinkedVisits, "function");
  assert.equal(typeof repository.findOrCreateEnquiryForContactReveal, "function");
});

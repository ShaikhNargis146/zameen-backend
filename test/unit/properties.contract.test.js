import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document access grants are owner-managed and downloads do not disclose existence", async () => {
  const [routes, service, repository] = await Promise.all([
    readFile(
      new URL("../../src/modules/properties/properties.routes.js", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../../src/modules/properties/properties.service.js", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL(
        "../../src/modules/properties/properties.repository.js",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  assert.match(service, /document\.visibility === "APPROVED_BUYERS" && hasGrant/);
  assert.match(service, /DOCUMENT_NOT_FOUND/);
  assert.match(repository, /expires_at IS NULL OR expires_at > now\(\)/);
  assert.match(repository, /grantDocumentAccess/);
  assert.match(repository, /eligibleDocumentGrantee/);
  assert.match(
    routes,
    /router\.get\(\n  "\/properties\/:propertyId\/documents\/:documentId",\n  requireAuth,\n  asyncRoute\(controller\.document\)/
  );
  assert.match(routes, /documents\/:documentId\/access-grants/);
  assert.match(routes, /documents\/:documentId\/access-grants\/:grantId/);
});

test("my-properties pagination orders unique property rows without DISTINCT", async () => {
  const repository = await readFile(
    new URL(
      "../../src/modules/properties/properties.repository.js",
      import.meta.url
    ),
    "utf8"
  );
  const ownedIds = repository.slice(
    repository.indexOf("export const ownedIds"),
    repository.indexOf("export const countOwned")
  );
  assert.doesNotMatch(ownedIds, /SELECT DISTINCT/);
  assert.match(ownedIds, /EXISTS \(SELECT 1 FROM land\.property_locations/);
  assert.match(ownedIds, /ORDER BY p\.updated_at DESC, p\.id DESC/);
});

test("parcel identifiers are resolved from the property's state configuration", async () => {
  const [service, repository] = await Promise.all([
    readFile(
      new URL("../../src/modules/properties/properties.service.js", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL(
        "../../src/modules/properties/properties.repository.js",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  const identifierTypes = repository.slice(
    repository.indexOf("export const identifierTypesForProperty"),
    repository.indexOf("export const replaceIdentifiers")
  );
  const replaceIdentifiers = repository.slice(
    repository.indexOf("export const replaceIdentifiers"),
    repository.indexOf("export const requestVerification")
  );
  assert.match(identifierTypes, /WITH RECURSIVE ancestors/);
  assert.match(identifierTypes, /state_location_id = state\.id/);
  assert.doesNotMatch(replaceIdentifiers, /WHERE code = \$1/);
  assert.match(service, /identifierTypesForProperty\s*\(\s*propertyId\s*\)/);
  assert.match(service, /PARCEL_CONFIG_UNAVAILABLE/);
});

test("document access grants use a PostgreSQL-safe table alias", async () => {
  const repository = await readFile(
    new URL(
      "../../src/modules/properties/properties.repository.js",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(repository, /property_document_access_grants access_grant/);
  assert.doesNotMatch(repository, /property_document_access_grants grant\b/);
  assert.match(repository, /const result = await pg\.tx/);
});

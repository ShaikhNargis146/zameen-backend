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
  assert.match(repository, /upsertDocumentAccessGrant/);
  assert.match(repository, /eligibleDocumentGrantee/);
  assert.match(
    routes,
    /router\.get\(\n  "\/properties\/:propertyId\/documents\/:documentId",\n  requireAuth,\n  asyncRoute\(controller\.document\)/
  );
  assert.match(routes, /documents\/:documentId\/access-grants/);
  assert.match(routes, /documents\/:documentId\/access-grants\/:grantId/);
});

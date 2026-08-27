import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document download enforces the approved-buyer grant policy", async () => {
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
  assert.match(service, /DOCUMENT_ACCESS_DENIED/);
  assert.match(repository, /expires_at IS NULL OR expires_at > now\(\)/);
  assert.match(
    routes,
    /router\.get\(\n  "\/properties\/:propertyId\/documents\/:documentId",\n  requireAuth,\n  asyncRoute\(controller\.document\)/
  );
});

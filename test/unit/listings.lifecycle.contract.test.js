import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin reinstate endpoint is wired behind requireAdmin", async () => {
  const routes = await readFile(
    new URL("../../src/modules/listings/listings.routes.js", import.meta.url),
    "utf8"
  );
  assert.match(
    routes,
    /router\.post\(\s*"\/admin\/listings\/:listingId\/reinstate",\s*requireAdmin,\s*asyncRoute\(controller\.reinstate\)/
  );
});

test("suspend and reinstate only apply from valid listing states", async () => {
  const repository = await readFile(
    new URL("../../src/modules/listings/listings.repository.js", import.meta.url),
    "utf8"
  );
  const suspend = repository.slice(
    repository.indexOf("export const suspend"),
    repository.indexOf("export const reinstate")
  );
  const reinstate = repository.slice(
    repository.indexOf("export const reinstate"),
    repository.indexOf("export const expirePublished")
  );
  assert.match(suspend, /SET status = 'SUSPENDED'/);
  assert.match(suspend, /status = ANY\('\{INACTIVE,PUBLISHED,PAUSED\}'::varchar\[\]\)/);
  assert.match(reinstate, /SET status = 'INACTIVE'/);
  assert.match(reinstate, /AND status = 'SUSPENDED'/);
});

test("reinstate rejects an invalid transition and a reinstated listing can be resumed", async () => {
  const service = await readFile(
    new URL("../../src/modules/listings/listings.service.js", import.meta.url),
    "utf8"
  );
  const reinstate = service.slice(
    service.indexOf("export const reinstate"),
    service.indexOf("export const reinstate") + 600
  );
  assert.match(reinstate, /LISTING_NOT_FOUND/);
  assert.match(reinstate, /INVALID_TRANSITION/);
  assert.match(reinstate, /Listing cannot be reinstated from its current state/);
  // reinstate() lands a listing back in INACTIVE, so resume must accept INACTIVE
  // to complete the suspend -> reinstate -> resume lifecycle.
  assert.match(service, /resume:\s*\{\s*valid:\s*\["PAUSED",\s*"INACTIVE"\]/);
});

test("published listings still expire via the sweep independent of admin actions", async () => {
  const repository = await readFile(
    new URL("../../src/modules/listings/listings.repository.js", import.meta.url),
    "utf8"
  );
  assert.match(
    repository,
    /export const expirePublished = \(\) =>[\s\S]*?WHERE status = 'PUBLISHED' AND expires_at IS NOT NULL AND expires_at <= now\(\)/
  );
});

test("the reinstate endpoint is documented in the integration spec and Postman collection", async () => {
  const [spec, postman] = await Promise.all([
    readFile(new URL("../../docs/Zameen_API_PLAN_FULL.md", import.meta.url), "utf8"),
    readFile(
      new URL("../../postman/Zameens-Dev1.postman_collection.json", import.meta.url),
      "utf8"
    )
  ]);
  assert.match(spec, /\/admin\/listings\/\{listingId\}\/reinstate/);
  assert.match(postman, /admin\/listings\/\{\{listingId\}\}\/reinstate/);
});

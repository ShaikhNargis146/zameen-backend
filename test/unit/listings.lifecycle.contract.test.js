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
  assert.match(reinstate, /CASE WHEN review_status = 'APPROVED' THEN 'PUBLISHED'/);
  assert.match(reinstate, /AND status = 'SUSPENDED'/);
});

test("approval and reinstatement publish listings without a second seller action", async () => {
  const repository = await readFile(
    new URL("../../src/modules/listings/listings.repository.js", import.meta.url),
    "utf8"
  );
  const service = await readFile(
    new URL("../../src/modules/listings/listings.service.js", import.meta.url),
    "utf8"
  );
  const reinstate = service.slice(
    service.indexOf("export const reinstate"),
    service.indexOf("export const reinstate") + 600
  );
  const approve = repository.slice(
    repository.indexOf("export const approve"),
    repository.indexOf("export const reject")
  );
  assert.match(approve, /review_status = 'APPROVED', status = 'PUBLISHED'/);
  assert.match(approve, /published_at = COALESCE\(published_at, now\(\)\)/);
  assert.match(reinstate, /LISTING_NOT_FOUND/);
  assert.match(reinstate, /INVALID_TRANSITION/);
  assert.match(reinstate, /Listing cannot be reinstated from its current state/);
  assert.match(service, /resume:\s*\{\s*valid:\s*\["PAUSED"\]/);
  assert.doesNotMatch(service, /resume:\s*\{\s*valid:\s*\["PAUSED",\s*"INACTIVE"\]/);
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

test("the reinstate endpoint is documented in the Postman collection", async () => {
  const [postman, specification] = await Promise.all([
    readFile(
      new URL("../../postman/Zameens-Dev1.postman_collection.json", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL(
        "../../Zameens_Phase1_UI_API_Integration_Specification.txt",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  assert.match(postman, /admin\/listings\/\{\{listingId\}\}\/reinstate/);
  assert.match(specification, /\/admin\/listings\/\{listingId\}\/reinstate/);
});

test("Postman makes the admin-approval publication workflow explicit", async () => {
  const postman = await readFile(
    new URL("../../postman/Zameens-Dev1.postman_collection.json", import.meta.url),
    "utf8"
  );
  assert.match(postman, /Listing publication flow — run in order/);
  assert.match(postman, /1\. Submit complete listing for moderation \(seller\)/);
  assert.match(postman, /2\. Approve and publish submitted listing \(admin\)/);
  assert.match(postman, /3\. Verify published public detail/);
  assert.match(postman, /\{\{adminAccessToken\}\}/);
});

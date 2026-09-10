import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("the canonical development upgrade remains available for existing databases", async () => {
  const directory = new URL("../../migrations/", import.meta.url);
  const [names, migration] = await Promise.all([
    readdir(directory),
    readFile(
      new URL(
        "../../migrations/001_canonical_development_upgrade.sql",
        import.meta.url
      ),
      "utf8"
    )
  ]);
  assert.ok(
    names.includes("001_canonical_development_upgrade.sql"),
    "the canonical development upgrade must remain available"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS land\.property_document_access_grants/);
  assert.match(migration, /DELETE FROM ops\.schema_migrations/);
});

test("the site visit enquiry link migration dedupes legacy rows and reports how many it cancelled", async () => {
  const migration = await readFile(
    new URL(
      "../../migrations/003_site_visits_enquiry_link.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(
    migration,
    /PARTITION BY listing_id, buyer_user_id, preferred_date, preferred_time_slot/
  );
  assert.match(
    migration,
    /WHERE status <> 'CANCELLED' AND buyer_user_id IS NOT NULL/
  );
  assert.match(migration, /SET status = 'CANCELLED'/);
  assert.match(migration, /GET DIAGNOSTICS cancelled_count = ROW_COUNT/);
  assert.match(
    migration,
    /RAISE NOTICE 'site-visit data upgrade: cancelled % duplicate site visit row\(s\)', cancelled_count/
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_site_visits_dedupe/
  );
});

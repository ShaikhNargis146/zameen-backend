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

test("approved inactive listings are published by the lifecycle upgrade", async () => {
  const migration = await readFile(
    new URL("../../migrations/003_listing_approval_publishes.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /review_status = 'APPROVED'/);
  assert.match(migration, /status = 'INACTIVE'/);
  assert.match(migration, /SET status = 'PUBLISHED'/);
  assert.match(migration, /published_at = COALESCE\(published_at, approved_at, now\(\)\)/);
  assert.match(migration, /expires_at IS NULL OR expires_at > now\(\)/);
});

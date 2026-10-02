import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pgPromise from "pg-promise";

import "../src/config/env.js";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preparedDirectory = ".location-import";
const skipPreparation = process.argv.includes("--skip-prepare");
const resetPgp = pgPromise();
// The application pool has a 15-second client query timeout, appropriate for
// API requests but not for a controlled, one-time catalog rebuild. This
// dedicated single-connection pool has no client timeout; the transaction is
// still atomic and every ordinary import step retains its normal safeguards.
const resetDb = resetPgp({
  connectionString: process.env.DATABASE_URL || undefined,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" }
      : false
});

if (!process.argv.includes("--confirm-reset")) {
  console.error(
    "Refusing to reset location data. Run this script with --confirm-reset, or use npm run locations:rebuild."
  );
  process.exitCode = 1;
} else {
  let databaseClosed = false;
  const closeDatabase = async () => {
    if (databaseClosed) return;
    databaseClosed = true;
    await resetDb.$pool.end();
  };

  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: rootDirectory, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
  };

  const reset = async () => {
    const deleted = await resetDb.tx(async transaction => {
      // The reset is atomic. Foreign keys protect unrelated business records:
      // an unexpected reference causes the whole transaction to roll back.
      await transaction.none("SET LOCAL statement_timeout = 0");
      const deleteRows = async (label, sql, params = []) => {
        const result = await transaction.result(sql, params);
        const total = result.rowCount;
        console.log(`[location-rebuild] deleted ${total} ${label}`);
        return total;
      };

      const propertyParcelIdentifiers = await deleteRows(
        "property parcel identifiers",
        "DELETE FROM land.property_parcel_identifiers"
      );
      const propertyLocations = await deleteRows(
        "property locations",
        "DELETE FROM land.property_locations"
      );
      const partnerLocations = await deleteRows(
        "channel-partner locations",
        "DELETE FROM account.channel_partner_locations"
      );
      await deleteRows(
        "parcel identifier types",
        "DELETE FROM land.parcel_identifier_types"
      );
      await deleteRows(
        "parcel configurations",
        "DELETE FROM land.parcel_configurations"
      );
      await deleteRows(
        "postal-code mappings",
        "DELETE FROM geo.postal_code_locations"
      );
      await deleteRows(
        "postal codes",
        "DELETE FROM geo.postal_codes"
      );
      await deleteRows("market trend series", "DELETE FROM content.market_trend_series");
      await deleteRows(
        "buyer-requirement location links",
        "UPDATE marketplace.buyer_requirements SET location_id = NULL WHERE location_id IS NOT NULL"
      );
      await deleteRows(
        "content-item location links",
        "UPDATE content.content_items SET location_id = NULL WHERE location_id IS NOT NULL"
      );
      await deleteRows(
        "auction location links",
        "UPDATE content.auctions SET location_id = NULL WHERE location_id IS NOT NULL"
      );
      await deleteRows(
        "investment-opportunity location links",
        "UPDATE content.investment_opportunities SET location_id = NULL WHERE location_id IS NOT NULL"
      );
      await deleteRows(
        "area-unit state links",
        "UPDATE land.area_units SET state_location_id = NULL WHERE state_location_id IS NOT NULL"
      );
      await deleteRows(
        "document-type state links",
        "UPDATE land.document_types SET state_location_id = NULL WHERE state_location_id IS NOT NULL"
      );
      // Nothing references aliases directly, so TRUNCATE is transactional and
      // avoids repeatedly maintaining the large trigram indexes row by row.
      await transaction.none("TRUNCATE TABLE geo.location_aliases");
      console.log("[location-rebuild] truncated location aliases");
      // PostgreSQL does not automatically index a foreign-key's referencing
      // column. This temporary full index prevents the self-referential
      // parent_id constraint from scanning every location for each delete.
      await transaction.none("CREATE INDEX idx_geo_locations_parent_id_reset ON geo.locations(parent_id)");
      for (const type of ["VILLAGE", "LOCALITY", "SUBDISTRICT", "CITY", "DISTRICT", "STATE", "COUNTRY"])
        await deleteRows(
          `${type.toLowerCase()} locations`,
          "DELETE FROM geo.locations WHERE type = $1",
          [type]
        );
      await transaction.none("DROP INDEX geo.idx_geo_locations_parent_id_reset");
      return {
        propertyParcelIdentifiers,
        propertyLocations,
        partnerLocations
      };
    });
    console.log(JSON.stringify({ reset: deleted }, null, 2));
  };

  const rebuildSearchIndexes = async () => {
    await resetDb.none(
      `CREATE INDEX IF NOT EXISTS idx_geo_locations_parent_type
         ON geo.locations(parent_id, type) WHERE is_active;
       CREATE INDEX IF NOT EXISTS idx_geo_locations_type_name
         ON geo.locations(type, name) WHERE is_active;
       CREATE INDEX IF NOT EXISTS idx_geo_locations_slug ON geo.locations(slug);
       CREATE INDEX IF NOT EXISTS idx_geo_locations_name_trgm
         ON geo.locations USING gin (name gin_trgm_ops);
       CREATE INDEX IF NOT EXISTS idx_geo_locations_name_prefix
         ON geo.locations (lower(name) text_pattern_ops) WHERE is_active;
       CREATE INDEX IF NOT EXISTS idx_geo_locations_center
         ON geo.locations USING gist(center);
       CREATE INDEX IF NOT EXISTS idx_geo_postal_code_locations_location
         ON geo.postal_code_locations(location_id);
       CREATE INDEX IF NOT EXISTS idx_geo_location_aliases_trgm
         ON geo.location_aliases USING gin (alias gin_trgm_ops);
       CREATE INDEX IF NOT EXISTS idx_geo_location_aliases_prefix
         ON geo.location_aliases (lower(alias) text_pattern_ops)`
    );
  };

  const dropSearchIndexes = async () => {
    await resetDb.none(
      `DROP INDEX IF EXISTS geo.idx_geo_locations_parent_type;
       DROP INDEX IF EXISTS geo.idx_geo_locations_type_name;
       DROP INDEX IF EXISTS geo.idx_geo_locations_slug;
       DROP INDEX IF EXISTS geo.idx_geo_locations_name_trgm;
       DROP INDEX IF EXISTS geo.idx_geo_locations_name_prefix;
       DROP INDEX IF EXISTS geo.idx_geo_locations_center;
       DROP INDEX IF EXISTS geo.idx_geo_postal_code_locations_location;
       DROP INDEX IF EXISTS geo.idx_geo_location_aliases_trgm;
       DROP INDEX IF EXISTS geo.idx_geo_location_aliases_prefix`
    );
  };

  let searchIndexesDropped = false;

  try {
    // Validate the source first. A malformed export must never result in a
    // successful reset followed by a failed rebuild. --skip-prepare exists
    // only to resume a rebuild immediately after this validation has passed.
    if (!skipPreparation) {
      run("python3", [
        "scripts/prepare-location-data.py",
        "--input-dir",
        "locations_data",
        "--output-dir",
        preparedDirectory
      ]);
      run(process.execPath, [
        "scripts/import-locations.js",
        "--input-dir",
        preparedDirectory,
        "--check"
      ]);
    }
    await dropSearchIndexes();
    searchIndexesDropped = true;
    await reset();
    run(process.execPath, [
      "scripts/import-locations.js",
      "--input-dir",
      preparedDirectory,
      "--apply",
      "--require-empty"
    ]);
    run(process.execPath, ["scripts/seed-state-masters.js"]);
    await rebuildSearchIndexes();
    await closeDatabase();
  } catch (error) {
    console.error(`Location rebuild failed: ${error.message}`);
    process.exitCode = 1;
    if (searchIndexesDropped && !databaseClosed) await rebuildSearchIndexes();
    await closeDatabase();
  }
}

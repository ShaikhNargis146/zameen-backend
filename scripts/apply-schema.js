import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../src/config/env.js";
import db from "../src/config/postgres.config.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(scriptDirectory, "../src/database/schema.sql");
const migrationsDirectory = path.join(scriptDirectory, "../migrations");

try {
  const existing = await db.one(
    "SELECT to_regclass('auth.users') IS NOT NULL AS schema_exists"
  );
  if (existing.schema_exists) {
    throw new Error("Canonical schema already exists. This clean-install command will not modify an existing database.");
  }

  const schemaSql = await readFile(schemaPath, "utf8");
  const migrationNames = (await readdir(migrationsDirectory))
    .filter(name => name.endsWith(".sql"))
    .sort();
  await db.tx(async transaction => {
    await transaction.none(schemaSql);
    await transaction.none(
      "CREATE SCHEMA IF NOT EXISTS ops; CREATE TABLE IF NOT EXISTS ops.schema_migrations (name varchar(255) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    for (const name of migrationNames)
      await transaction.none(
        "INSERT INTO ops.schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [name]
      );
  });
  console.log("Canonical database schema created successfully.");
} finally {
  await db.$pool.end();
}

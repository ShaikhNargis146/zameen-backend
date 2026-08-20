import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../src/config/env.js";
import db from "../src/config/postgres.config.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(scriptDirectory, "../src/database/schema.sql");

try {
  const existing = await db.one(
    "SELECT to_regclass('auth.users') IS NOT NULL AS schema_exists"
  );
  if (existing.schema_exists) {
    throw new Error("Canonical schema already exists. This clean-install command will not modify an existing database.");
  }

  const schemaSql = await readFile(schemaPath, "utf8");
  await db.tx(transaction => transaction.none(schemaSql));
  console.log("Canonical database schema created successfully.");
} finally {
  await db.$pool.end();
}

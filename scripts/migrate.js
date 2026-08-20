import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../src/config/env.js";
import db from "../src/config/postgres.config.js";

const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

try {
  await db.none(`CREATE SCHEMA IF NOT EXISTS ops; CREATE TABLE IF NOT EXISTS ops.schema_migrations (name varchar(255) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await db.any(`SELECT name FROM ops.schema_migrations`)).map(row => row.name));
  const names = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = await readFile(path.join(directory, name), "utf8");
    await db.tx(async transaction => {
      await transaction.none(sql);
      await transaction.none(`INSERT INTO ops.schema_migrations (name) VALUES ($1)`, [name]);
    });
    console.log(`Applied ${name}`);
  }
} finally {
  await db.$pool.end();
}

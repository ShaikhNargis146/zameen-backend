import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse";
import {
  lgdSlug,
  locationTypes,
  stateCodeForLgd
} from "../src/modules/catalog/location-import.constants.js";

const expectedFiles = Object.freeze([
  "states.csv",
  "districts.csv",
  "subdistricts.csv",
  "villages.csv",
  "metadata.json"
]);
// A large enough batch keeps Cloud SQL round-trips practical while each
// transaction remains bounded and independently restartable.
const batchSize = 20000;

const argumentValue = (name, defaultValue = null) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? defaultValue : process.argv[index + 1] || defaultValue;
};

const inputDirectory = path.resolve(argumentValue("--input-dir", ".location-import"));
const shouldApply = process.argv.includes("--apply");

const required = (value, label) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};

const readCsv = async function* (filename) {
  const parser = createReadStream(path.join(inputDirectory, filename)).pipe(
    parse({ columns: true, bom: true, skip_empty_lines: true, trim: true })
  );
  for await (const record of parser) yield record;
};

const validatePreparedFiles = async () => {
  await Promise.all(
    expectedFiles.map(filename => access(path.join(inputDirectory, filename)))
  );
  const metadata = JSON.parse(
    await readFile(path.join(inputDirectory, "metadata.json"), "utf8")
  );
  if (metadata.source !== "Local Government Directory (LGD)") {
    throw new Error("metadata.json is not an LGD location-data export.");
  }
  return metadata;
};

const validateData = async () => {
  const summary = { states: 0, districts: 0, subdistricts: 0, villages: 0 };
  const states = new Set();
  const districts = new Set();
  const subdistricts = new Set();

  for await (const row of readCsv("states.csv")) {
    const code = required(row.code, "State code");
    required(row.name, `State ${code} name`);
    if (!stateCodeForLgd(code)) {
      throw new Error(`LGD state code ${code} has no API state-code mapping.`);
    }
    states.add(code);
    summary.states += 1;
  }
  for await (const row of readCsv("districts.csv")) {
    const code = required(row.code, "District code");
    const stateCode = required(row.state_code, `District ${code} state code`);
    required(row.name, `District ${code} name`);
    if (!states.has(stateCode)) {
      throw new Error(`District ${code} references absent state ${stateCode}.`);
    }
    districts.add(code);
    summary.districts += 1;
  }
  for await (const row of readCsv("subdistricts.csv")) {
    const code = required(row.code, "Sub-district code");
    const districtCode = required(row.district_code, `Sub-district ${code} district code`);
    required(row.name, `Sub-district ${code} name`);
    if (!districts.has(districtCode)) {
      throw new Error(`Sub-district ${code} references absent district ${districtCode}.`);
    }
    subdistricts.add(code);
    summary.subdistricts += 1;
  }
  for await (const row of readCsv("villages.csv")) {
    const code = required(row.code, "Village code");
    const subdistrictCode = required(row.subdistrict_code, `Village ${code} sub-district code`);
    required(row.name, `Village ${code} name`);
    if (!subdistricts.has(subdistrictCode)) {
      throw new Error(`Village ${code} references absent sub-district ${subdistrictCode}.`);
    }
    summary.villages += 1;
  }
  return summary;
};

const ensureIndia = async db => {
  await db.none(
    `INSERT INTO geo.locations (type, name, slug)
     VALUES ('COUNTRY', 'India', 'india') ON CONFLICT DO NOTHING`
  );
  return db.one(
    `SELECT id FROM geo.locations
     WHERE type = 'COUNTRY' AND parent_id IS NULL AND slug = 'india'`
  );
};

const locationIdsBySlug = async (db, type) => {
  const rows = await db.any(
    `SELECT id, slug FROM geo.locations
     WHERE type = $1 AND slug LIKE $2`,
    [type, `${lgdSlug(type, "")}%`]
  );
  return new Map(rows.map(row => [row.slug, row.id]));
};

const applyLocationBatch = async (db, type, rows) => {
  const payload = JSON.stringify(rows);
  await db.tx(async transaction => {
    await transaction.none(
      `INSERT INTO geo.locations (parent_id, type, name, slug, state_code, is_active)
       SELECT source.parent_id, $2, source.name, source.slug, source.state_code, true
       FROM jsonb_to_recordset($1::jsonb)
         AS source(parent_id uuid, name varchar, slug varchar, state_code varchar)
       ON CONFLICT DO NOTHING`,
      [payload, type]
    );
    await transaction.none(
      `UPDATE geo.locations location
       SET name = source.name,
           state_code = source.state_code,
           is_active = true,
           updated_at = now()
       FROM jsonb_to_recordset($1::jsonb)
         AS source(parent_id uuid, name varchar, slug varchar, state_code varchar)
       WHERE location.parent_id = source.parent_id
         AND location.type = $2
         AND location.slug = source.slug`,
      [payload, type]
    );
    const aliases = rows
      .filter(row => row.alias && row.alias !== row.name)
      .map(row => ({ parent_id: row.parent_id, slug: row.slug, alias: row.alias }));
    if (!aliases.length) return;
    await transaction.none(
      `INSERT INTO geo.location_aliases (location_id, alias, language_code)
       SELECT location.id, source.alias, 'und'
       FROM jsonb_to_recordset($1::jsonb)
         AS source(parent_id uuid, slug varchar, alias varchar)
       JOIN geo.locations location
         ON location.parent_id = source.parent_id
        AND location.type = $2
        AND location.slug = source.slug
       ON CONFLICT (location_id, alias, language_code) DO NOTHING`,
      [JSON.stringify(aliases), type]
    );
  });
};

const importDataset = async ({ db, filename, type, parentIdForRow }) => {
  let processed = 0;
  let batch = [];
  for await (const record of readCsv(filename)) {
    const code = required(record.code, `${type} code`);
    const sourceStateCode = record.state_code || (type === "STATE" ? code : null);
    const stateCode = stateCodeForLgd(required(sourceStateCode, `${type} state code`));
    if (!stateCode) {
      throw new Error(`LGD state code ${sourceStateCode} has no API state-code mapping.`);
    }
    batch.push({
      parent_id: parentIdForRow(record),
      name: required(record.name, `${type} ${code} name`),
      slug: lgdSlug(type, code),
      state_code: stateCode,
      alias: String(record.local_name || "").trim() || null
    });
    if (batch.length === batchSize) {
      await applyLocationBatch(db, type, batch);
      processed += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await applyLocationBatch(db, type, batch);
    processed += batch.length;
  }
  return processed;
};

const applyData = async () => {
  await import("../src/config/env.js");
  const { default: db } = await import("../src/config/postgres.config.js");
  try {
    const schema = await db.one(
      "SELECT to_regclass('geo.locations') IS NOT NULL AS exists"
    );
    if (!schema.exists) {
      throw new Error("Canonical schema is missing. Run npm run db:schema on a new database first.");
    }
    const india = await ensureIndia(db);
    const states = await importDataset({
      db,
      filename: "states.csv",
      type: locationTypes.states,
      parentIdForRow: () => india.id
    });
    const stateIds = await locationIdsBySlug(db, locationTypes.states);
    const districts = await importDataset({
      db,
      filename: "districts.csv",
      type: locationTypes.districts,
      parentIdForRow: row => {
        const id = stateIds.get(lgdSlug(locationTypes.states, row.state_code));
        if (!id) throw new Error(`State ${row.state_code} was not imported.`);
        return id;
      }
    });
    const districtIds = await locationIdsBySlug(db, locationTypes.districts);
    const subdistricts = await importDataset({
      db,
      filename: "subdistricts.csv",
      type: locationTypes.subdistricts,
      parentIdForRow: row => {
        const id = districtIds.get(lgdSlug(locationTypes.districts, row.district_code));
        if (!id) throw new Error(`District ${row.district_code} was not imported.`);
        return id;
      }
    });
    const subdistrictIds = await locationIdsBySlug(db, locationTypes.subdistricts);
    const villages = await importDataset({
      db,
      filename: "villages.csv",
      type: locationTypes.villages,
      parentIdForRow: row => {
        const id = subdistrictIds.get(lgdSlug(locationTypes.subdistricts, row.subdistrict_code));
        if (!id) throw new Error(`Sub-district ${row.subdistrict_code} was not imported.`);
        return id;
      }
    });
    const totals = await db.any(
      `SELECT type, count(*)::int AS count FROM geo.locations
       WHERE type = ANY($1::varchar[]) GROUP BY type ORDER BY type`,
      [["COUNTRY", "STATE", "DISTRICT", "SUBDISTRICT", "VILLAGE"]]
    );
    return { imported: { states, districts, subdistricts, villages }, totals };
  } finally {
    await db.$pool.end();
  }
};

try {
  const metadata = await validatePreparedFiles();
  const checked = await validateData();
  const result = shouldApply ? await applyData() : { checked };
  console.log(JSON.stringify({ metadata, ...result }, null, 2));
} catch (error) {
  console.error(`Location import failed: ${error.message}`);
  process.exitCode = 1;
}

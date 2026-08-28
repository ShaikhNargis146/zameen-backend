import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse";
import {
  lgdSlug,
  locationTypes,
  normalizeLocationLabel,
  stateCodeForLgd
} from "../src/modules/catalog/location-import.constants.js";

const locationFiles = Object.freeze([
  "states.csv",
  "districts.csv",
  "subdistricts.csv",
  "villages.csv"
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
const onlyPincodes = process.argv.includes("--only-pincodes");

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
  const expectedFiles = [
    ...(onlyPincodes ? [] : locationFiles),
    "metadata.json"
  ];
  await Promise.all(
    expectedFiles.map(filename => access(path.join(inputDirectory, filename)))
  );
  const metadata = JSON.parse(
    await readFile(path.join(inputDirectory, "metadata.json"), "utf8")
  );
  if (onlyPincodes && !metadata.datasets?.pincodes) {
    throw new Error("metadata.json does not describe a PIN data export.");
  }
  return metadata;
};

const validateData = async metadata => {
  const summary = {};
  const pincodes = new Set();
  if (metadata.datasets?.pincodes) {
    await access(path.join(inputDirectory, "pincodes.csv"));
    summary.pincodes = 0;
    for await (const row of readCsv("pincodes.csv")) {
      const code = required(row.code, "PIN code");
      if (!/^\d{6}$/.test(code)) {
        throw new Error(`PIN code ${code} must contain exactly six digits.`);
      }
      required(row.state_name, `PIN ${code} state name`);
      required(row.district_name, `PIN ${code} district name`);
      pincodes.add(code);
      summary.pincodes += 1;
    }
    summary.uniquePincodes = pincodes.size;
  }
  if (onlyPincodes) return summary;

  Object.assign(summary, { states: 0, districts: 0, subdistricts: 0, villages: 0 });
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

const districtReference = async db => {
  const rows = await db.any(
    `SELECT district.id AS district_id,
            district.name AS district_name,
            state.id AS state_id,
            state.name AS state_name,
            state.state_code
     FROM geo.locations district
     JOIN geo.locations state ON state.id = district.parent_id
     WHERE district.type = 'DISTRICT' AND district.is_active = true`
  );
  const states = new Map();
  const districts = new Map();
  for (const row of rows) {
    const stateName = normalizeLocationLabel(row.state_name);
    states.set(stateName, { id: row.state_id, code: row.state_code });
    districts.set(
      `${row.state_id}|${normalizeLocationLabel(row.district_name)}`,
      row.district_id
    );
  }
  return { states, districts };
};

const collectPincodes = async db => {
  const { states, districts } = await districtReference(db);
  const postalCodes = new Map();
  const links = new Map();
  const unmatchedStateLabels = new Set();
  const unmatchedDistrictLabels = new Set();
  let rows = 0;

  for await (const row of readCsv("pincodes.csv")) {
    const code = required(row.code, "PIN code");
    const stateName = required(row.state_name, `PIN ${code} state name`);
    const districtName = required(row.district_name, `PIN ${code} district name`);
    const postalCode = postalCodes.get(code) || { code, stateCodes: new Set() };
    postalCodes.set(code, postalCode);
    const state = states.get(normalizeLocationLabel(stateName));
    if (!state) {
      unmatchedStateLabels.add(stateName);
      rows += 1;
      continue;
    }
    postalCode.stateCodes.add(state.code);
    const districtId = districts.get(
      `${state.id}|${normalizeLocationLabel(districtName)}`
    );
    if (!districtId) {
      unmatchedDistrictLabels.add(`${stateName}|${districtName}`);
      rows += 1;
      continue;
    }
    links.set(`${code}|${districtId}`, { code, location_id: districtId });
    rows += 1;
  }

  return {
    postalCodes: [...postalCodes.values()].map(postalCode => ({
      code: postalCode.code,
      state_code:
        postalCode.stateCodes.size === 1
          ? [...postalCode.stateCodes][0]
          : null
    })),
    links: [...links.values()],
    diagnostics: {
      rows,
      uniquePincodes: postalCodes.size,
      verifiedDistrictLinks: links.size,
      pincodesWithAmbiguousStates: [...postalCodes.values()].filter(
        postalCode => postalCode.stateCodes.size > 1
      ).length,
      unmatchedStateLabels: unmatchedStateLabels.size,
      unmatchedDistrictLabels: unmatchedDistrictLabels.size
    }
  };
};

const chunks = (items, size) => {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const importPincodes = async db => {
  const collected = await collectPincodes(db);
  for (const rows of chunks(collected.postalCodes, batchSize)) {
    await db.none(
      `INSERT INTO geo.postal_codes (code, state_code)
       SELECT source.code, source.state_code
       FROM jsonb_to_recordset($1::jsonb)
         AS source(code varchar, state_code varchar)
       ON CONFLICT (code) DO UPDATE SET state_code = EXCLUDED.state_code`,
      [JSON.stringify(rows)]
    );
  }
  for (const rows of chunks(collected.links, batchSize)) {
    await db.none(
      `INSERT INTO geo.postal_code_locations (postal_code_id, location_id)
       SELECT postal_code.id, source.location_id
       FROM jsonb_to_recordset($1::jsonb)
         AS source(code varchar, location_id uuid)
       JOIN geo.postal_codes postal_code ON postal_code.code = source.code
       ON CONFLICT (postal_code_id, location_id) DO NOTHING`,
      [JSON.stringify(rows)]
    );
  }
  return collected.diagnostics;
};

const applyData = async metadata => {
  await import("../src/config/env.js");
  const { default: db } = await import("../src/config/postgres.config.js");
  try {
    const schema = await db.one(
      "SELECT to_regclass('geo.locations') IS NOT NULL AS exists"
    );
    if (!schema.exists) {
      throw new Error("Canonical schema is missing. Run npm run db:schema on a new database first.");
    }
    let locations = null;
    if (!onlyPincodes) {
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
          const id = subdistrictIds.get(
            lgdSlug(locationTypes.subdistricts, row.subdistrict_code)
          );
          if (!id) throw new Error(`Sub-district ${row.subdistrict_code} was not imported.`);
          return id;
        }
      });
      locations = { states, districts, subdistricts, villages };
    }
    const pincodes = metadata.datasets?.pincodes
      ? await importPincodes(db)
      : null;
    const totals = await db.any(
      `SELECT type, count(*)::int AS count FROM geo.locations
       WHERE type = ANY($1::varchar[]) GROUP BY type ORDER BY type`,
      [["COUNTRY", "STATE", "DISTRICT", "SUBDISTRICT", "VILLAGE"]]
    );
    const postalCodeTotal = metadata.datasets?.pincodes
      ? await db.one("SELECT count(*)::int AS count FROM geo.postal_codes")
      : null;
    return { imported: { locations, pincodes }, totals, postalCodeTotal };
  } finally {
    await db.$pool.end();
  }
};

try {
  const metadata = await validatePreparedFiles();
  const checked = await validateData(metadata);
  const result = shouldApply ? await applyData(metadata) : { checked };
  console.log(JSON.stringify({ metadata, ...result }, null, 2));
} catch (error) {
  console.error(`Location import failed: ${error.message}`);
  process.exitCode = 1;
}

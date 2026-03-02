// postgres_store.js (PATCHED)
// ============================================================
// ✅ Safer identifier handling (table names)
// ✅ Consistent JSONB handling across insert/update/upsert
// ✅ Upsert now skips conflict columns in UPDATE SET
// ✅ list() enforces server-defined orderBy mapping
// ✅ getOne uses oneOrNone (API-friendly)
// ============================================================

import db from "../config/postgres.config.js";
import pgPromise from "pg-promise";

const pgp = pgPromise({
  capSQL: true
});

// ---- helpers
const ok = data => ({ ok: true, data, error: null });
const fail = error => ({ ok: false, data: null, error });

// ------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------

/**
 * Build ColumnSet columns with JSON handling.
 * Use :json modifier so pg-promise safely JSON.stringify() objects.
 */
function buildCols({ columns, jsonbCols = [] }) {
  return columns.map(c => {
    if (jsonbCols.includes(c)) {
      return { name: c, mod: ":json" };
    }
    return c;
  });
}

/**
 * Strict table formatting using ${table~}
 * Never pass untrusted table names; use server-side constants only.
 */
function formatTable(table) {
  return pgp.as.format("${table~}", { table });
}

/**
 * OrderBy allowlist mapping (prevents injection).
 * Only server-defined keys are allowed.
 */
const ORDER_BY = Object.freeze({
  newest: "created_at DESC",
  oldest: "created_at ASC",
  updated_newest: "updated_at DESC",
  updated_oldest: "updated_at ASC"
  // Add more server-safe sorts here, e.g.
  // price_low: "price_total ASC NULLS LAST",
  // price_high: "price_total DESC NULLS LAST",
});

// ------------------------------------------------------------
// CRUD helpers
// ------------------------------------------------------------

const insertOne = async ({
  table,
  values,
  columns,
  returning = "*",
  jsonbCols = []
}) => {
  try {
    const cols = buildCols({ columns, jsonbCols });
    const cs = new pgp.helpers.ColumnSet(cols, { table });
    const q = pgp.helpers.insert(values, cs) + ` RETURNING ${returning}`;
    const row = await db.one(q);
    return ok(row);
  } catch (e) {
    return fail(e);
  }
};

const insertMany = async ({
  table,
  values,
  columns,
  returning = "id",
  jsonbCols = []
}) => {
  try {
    const cols = buildCols({ columns, jsonbCols });
    const cs = new pgp.helpers.ColumnSet(cols, { table });
    const q = pgp.helpers.insert(values, cs) + ` RETURNING ${returning}`;
    const rows = await db.any(q);
    return ok(rows);
  } catch (e) {
    return fail(e);
  }
};

/**
 * Upsert:
 * conflictCols: ["id"] or ["org_id","name"]
 * NOTE: UPDATE SET skips conflict columns to avoid updating keys.
 */
const upsertOne = async ({
  table,
  values,
  columns,
  conflictCols = ["id"],
  returning = "*",
  jsonbCols = []
}) => {
  try {
    const cols = buildCols({ columns, jsonbCols });
    const cs = new pgp.helpers.ColumnSet(cols, { table });

    // Build "col1, col2" conflict identifier list safely
    const conflict = conflictCols.map(c => pgp.as.name(c)).join(", ");

    // Create an update ColumnSet that skips conflict columns
    // so "id" or unique keys are not updated.
    const csUpdate = cs.extend([], { skip: conflictCols });

    const q =
      pgp.helpers.insert(values, cs) +
      ` ON CONFLICT (${conflict}) DO UPDATE SET ` +
      pgp.helpers.sets(values, csUpdate) +
      ` RETURNING ${returning}`;

    const row = await db.one(q);
    return ok(row);
  } catch (e) {
    return fail(e);
  }
};

/**
 * Safe update with explicit where clause + params
 * where: "id = ${id}" or "org_id=${org_id} AND id=${id}"
 */
const updateWhere = async ({
  table,
  set, // object of columns to update
  where, // string with pgp named params
  params = {}, // object
  returning = "*",
  jsonbCols = []
}) => {
  try {
    const keys = Object.keys(set || {});
    if (!keys.length) return fail(new Error("Nothing to update"));

    const cols = buildCols({ columns: keys, jsonbCols });
    const cs = new pgp.helpers.ColumnSet(cols, { table });

    const q =
      pgp.helpers.update(set, cs) + ` WHERE ${where} RETURNING ${returning}`;

    const row = await db.one(q, params);
    return ok(row);
  } catch (e) {
    return fail(e);
  }
};

/**
 * Get one row safely
 * Returns ok(null) if not found
 * where: "org_id=${org_id} AND id=${id}"
 */
const getOne = async ({ table, where, params = {} }) => {
  try {
    const t = formatTable(table);
    const q = `SELECT * FROM ${t} WHERE ${where}`;
    const row = await db.oneOrNone(q, params);
    return ok(row);
  } catch (e) {
    return fail(e);
  }
};

/**
 * List + Count with safe filters and pagination
 * where can be null (no filters)
 * orderKey must be server-defined (ORDER_BY keys)
 */
const list = async ({
  table,
  where = null,
  params = {},
  orderKey = "newest",
  limit = 20,
  offset = 0
}) => {
  try {
    const t = formatTable(table);
    const whereSql = where ? ` WHERE ${where}` : "";

    const orderBy = ORDER_BY[orderKey] || ORDER_BY.newest;

    const dataQ = `
      SELECT * FROM ${t}
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $/limit/ OFFSET $/offset/
    `;

    const countQ = `
      SELECT COUNT(*)::int AS count
      FROM ${t}
      ${whereSql}
    `;

    const qParams = { ...params, limit, offset };
    const [rows, countRow] = await db.tx(async tx => {
      const rows = await tx.any(dataQ, qParams);
      const countRow = await tx.one(countQ, params);
      return [rows, countRow];
    });

    return ok({ rows, count: countRow.count, limit, offset });
  } catch (e) {
    return fail(e);
  }
};

/**
 * Raw query but still safe (only server supplies query)
 */
const any = async (query, params) => {
  try {
    const rows = await db.any(query, params);
    return ok(rows);
  } catch (e) {
    return fail(e);
  }
};

const one = async (query, params) => {
  try {
    const row = await db.one(query, params);
    return ok(row);
  } catch (e) {
    return fail(e);
  }
};

const oneOrNone = async (query, params) => {
  try {
    const row = await db.oneOrNone(query, params);
    return ok(row);
  } catch (e) {
    return fail(e);
  }
};

const none = async (query, params) => {
  try {
    await db.none(query, params);
    return ok(null);
  } catch (e) {
    return fail(e);
  }
};

/**
 * Transaction wrapper
 */
const tx = async fn => {
  try {
    const result = await db.tx(fn);
    return ok(result);
  } catch (e) {
    return fail(e);
  }
};

export { pgp, ORDER_BY };

export default {
  insertOne,
  insertMany,
  upsertOne,
  updateWhere,
  getOne,
  list,
  any,
  one,
  oneOrNone,
  none,
  tx
};

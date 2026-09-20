import pgPromise from "pg-promise";
import logger from "../utils/logger.js";
import constants from "../constants/index.js";

const initOptions = {
  // logs ALL query errors (super useful)
  error(err, e) {
    // e.query, e.params exist sometimes
    logger.error("[PGP] error", {
      message: err?.message,
      code: err?.code,
      query: e?.query
    });
  }
};

const pgp = pgPromise(initOptions);

const connectionString = process.env.DATABASE_URL || null;
const cn = {
  ...(connectionString
    ? { connectionString }
    : {
        host: constants.database.host,
        port: constants.database.port,
        database: constants.database.database,
        user: constants.database.user,
        password: constants.database.password
      }),

  // ✅ IMPORTANT: make connections stable on VMs / NAT / proxies
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,

  // ✅ Pool tuning (prevents random disconnect pain)
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,

  // ✅ Bounds how long any single query may run. Without this, a handful of
  // concurrent expensive-but-valid queries (e.g. the live-regex listing
  // search in discovery.repository.js) can hold connections open long
  // enough to exhaust the 20-connection pool above, stalling every other
  // module sharing it — not just the endpoint that issued them.
  // statement_timeout is enforced by Postgres itself (cancels the query
  // server-side); query_timeout is the client-side counterpart.
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),
  query_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),

  ssl:
    process.env.DB_SSL === "true"
      ? {
          rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false"
        }
      : false
};

const db = pgp(cn);

export default db;

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

const cn = {
  host: constants.database.host,
  port: constants.database.port,
  database: constants.database.database,
  user: constants.database.user,
  password: constants.database.password,

  // ✅ IMPORTANT: make connections stable on VMs / NAT / proxies
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,

  // ✅ Pool tuning (prevents random disconnect pain)
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,

  ssl: false
  // ssl: {
  //   rejectUnauthorized: false
  // }
};

const db = pgp(cn);

export default db;

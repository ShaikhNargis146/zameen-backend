import "./config/env.js"; // first

import app from "./config/express.config.js";
import "./config/postgres.config.js";
import logger from "./utils/logger.js";
import constants from "./constants/index.js";

const { port, env } = constants;

app.listen(port, "0.0.0.0", err => {
  if (err) {
    logger.error(`server failed to start: ${err.message}`);
    return;
  }
  logger.info(`server started [env, port] = [${env}, ${port}]`);
});

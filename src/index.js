import "./config/env.js"; // first

import app from "./config/express.config.js";
import "./config/postgres.config.js";
import logger from "./utils/logger.js";
import constants from "./constants/index.js";
import { expirePublishedListings } from "./modules/listings/listings.service.js";

const { port, env } = constants;

const LISTING_EXPIRY_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const runListingExpirySweep = () => {
  expirePublishedListings().catch(error =>
    logger.error(`listing expiry sweep failed: ${error.message}`)
  );
};

app.listen(port, "0.0.0.0", err => {
  if (err) {
    logger.error(`server failed to start: ${err.message}`);
    return;
  }
  logger.info(`server started [env, port] = [${env}, ${port}]`);
  runListingExpirySweep();
  setInterval(runListingExpirySweep, LISTING_EXPIRY_SWEEP_INTERVAL_MS);
});

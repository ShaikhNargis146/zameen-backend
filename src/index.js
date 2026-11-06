import "./config/env.js"; // first

import app from "./config/express.config.js";
import "./config/postgres.config.js";
import logger from "./utils/logger.js";
import constants from "./constants/index.js";
import { expirePublishedListings } from "./modules/listings/listings.service.js";
import { reconcileStalePayments } from "./modules/commerce/commerce.service.js";

const { port, env } = constants;

const LISTING_EXPIRY_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const runListingExpirySweep = () => {
  expirePublishedListings().catch(error =>
    logger.error(`listing expiry sweep failed: ${error.message}`)
  );
};

// Pending payments whose callback and webhook both never landed. Two-minute
// cadence keeps the stuck window short; a run that is still going when the
// next tick fires is skipped rather than stacked.
const PAYMENT_RECONCILE_INTERVAL_MS = 2 * 60 * 1000;
let paymentReconcileRunning = false;
const runPaymentReconciliation = () => {
  if (paymentReconcileRunning) return;
  paymentReconcileRunning = true;
  reconcileStalePayments()
    .then(summary => {
      if (summary.checked) logger.info(`payment reconciliation ${JSON.stringify(summary)}`);
    })
    .catch(error => logger.error(`payment reconciliation failed: ${error.message}`))
    .finally(() => {
      paymentReconcileRunning = false;
    });
};

app.listen(port, "0.0.0.0", err => {
  if (err) {
    logger.error(`server failed to start: ${err.message}`);
    return;
  }
  logger.info(`server started [env, port] = [${env}, ${port}]`);
  runListingExpirySweep();
  setInterval(runListingExpirySweep, LISTING_EXPIRY_SWEEP_INTERVAL_MS);
  runPaymentReconciliation();
  setInterval(runPaymentReconciliation, PAYMENT_RECONCILE_INTERVAL_MS);
});

import "../config/env.js"; // MUST be first

import common from "./constants.common.js";
import dev from "./constants.dev.js";
import prod from "./constants.prod.js";

const env = process.env.NODE_ENV || "development";
const envConfig = env === "production" ? prod : dev;

const constants = {
  ...common,
  ...envConfig,
  env,
  port: Number(process.env.PORT || common.port || 3000)
};

export default constants;

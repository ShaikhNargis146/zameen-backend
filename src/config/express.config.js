import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import logs from "../constants/index.js";

import cors from "./cors.config.js";
import routes from "../routes/v1/index.js";
import error from "../middlewares/error.js";

/**
 * Express instance
 * @public
 */
const app = express();

// request logging. dev: console | production: file
app.use(morgan("combined", logs));

// CORS configuration
app.use(cors());

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// secure apps by setting various HTTP headers
app.use(helmet());

/**
 * App Configurations
 */

// mount api v1 routes
app.use("/api/v1", routes);

// if error is not an instanceOf APIError, convert it.
app.use(error.converter);

// catch 404 and forward to error handler
app.use(error.notFound);

// error handler, send stacktrace only during development
app.use(error.handler);

export default app;

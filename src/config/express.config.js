import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import tmp from "tmp";
import path from "path";
import logs from "../constants/index.js";

// const session = require('./session.config');
import cors from "./cors.config.js";
import clientLogs from "./client-log.config.js";

import routes from "../api/routes/v1/index.js";
import error from "../middlewares/error.js";

/**
 * Express instance
 * @public
 */
const app = express();

// Set 'views' directory for any views
// being rendered res.render()
app.set("views", "./src/view");
app.set("view engine", "ejs");

// TODO: Include CSRF middlewares here

// request logging. dev: console | production: file
app.use(morgan("combined", logs));

// This middleware take care of the origin when the origin is undefined.
// origin is undefined when request is local
app.use((req, _, next) => {
  req.headers.origin = req.headers.origin || req.headers.host;
  next();
});

// CORS configuration
app.use(cors());

// parse body params and attache them to req.body
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

// secure apps by setting various HTTP headers
app.use(helmet());

/**
 * App Configurations
 */

// session configuration
// app.use(session());

// mount api v1 routes
app.use("/api/v1", routes);
app.use("/api/client-log", clientLogs);

app.use("/static", express.static(process.env.UPLOAD_PATH));

// if error is not an instanceOf APIError, convert it.
app.use(error.converter);

// catch 404 and forward to error handler
app.use(error.notFound);

// error handler, send stacktrace only during development
app.use(error.handler);

// temporary files created using tmp will be deleted on UncaughtException
tmp.setGracefulCleanup();

export default app;

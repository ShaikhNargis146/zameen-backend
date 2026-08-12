import httpStatus from "http-status";
import { ValidationError } from "express-validation";
import APIError from "../utils/APIError.js";

/**
 * Error handler. Send stacktrace only during development
 * @public
 */

const handler = (err, req, res, next) => {
  try {
    // If headers already sent (SSE or streaming), DO NOT write json.
    if (res.headersSent) {
      // Best effort: if it's SSE, emit an error event then end.
      try {
        const ct = res.getHeader("Content-Type");
        const isSSE = ct && String(ct).includes("text/event-stream");
        if (isSSE && !res.writableEnded) {
          res.write(`event: error\n`);
          res.write(
            `data: ${JSON.stringify({
              message: err?.message || "Stream failed"
            })}\n\n`
          );
          res.end();
        }
      } catch (_) {}
      return;
    }

    const status =
      err?.status || err?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;

    const isServerError = status >= httpStatus.INTERNAL_SERVER_ERROR;
    const payload = {
      success: false,
      error: {
        code: isServerError ? "INTERNAL_ERROR" : err?.code || "REQUEST_ERROR",
        message:
          isServerError && process.env.NODE_ENV === "production"
            ? "Internal Server Error"
            : err?.message || "Internal Server Error"
      }
    };
    const details = err?.details || err?.errors?.details;
    if (!isServerError && details?.length) payload.error.details = details;

    return res.status(status).json(payload);
  } catch (e) {
    // last resort
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Internal Server Error" }
      });
    }
  }
};

/**
 * If error is not an instanceOf APIError, convert it.
 * @public
 */
const converter = (err, req, res, next) => {
  let convertedError = err;

  if (err instanceof ValidationError) {
    convertedError = new APIError({
      message: "Validation Error",
      errors: { details: err.errors },
      status: err.status || httpStatus.INTERNAL_SERVER_ERROR,
      stack: err.stack
    });
  } else if (!(err instanceof APIError)) {
    convertedError = new APIError({
      message:
        err.status && err.status < 500 ? err.message : "Internal Server Error",
      code: err.code || "INTERNAL_ERROR",
      errors: {
        details: err.status && err.status < 500 ? err.details : undefined
      },
      status: err.status || httpStatus.INTERNAL_SERVER_ERROR,
      stack: err.stack
    });
  }

  return handler(convertedError, req, res);
};

/**
 * Catch 404 and forward to error handler
 * @public
 */
const notFound = (req, res) => {
  const err = new APIError({
    message: "Not found",
    status: httpStatus.NOT_FOUND
  });
  return handler(err, req, res);
};
export default {
  converter,
  handler,
  notFound
};

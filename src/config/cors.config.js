import cors from "cors";
import httpStatus from "http-status";
import APIError from "../utils/APIError.js";

const allowedOrigins = new Set([
  "localhost",
  "localhost:8000",
  "35.184.18.131",
  "http://localhost:8000",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://34.170.188.127:8080",
  "34.170.188.127:8080",
  "http://localhost:8080",
  "localhost:8080"

  // add domain later:
  // "https://api.floora.ai",
  // "https://app.floora.ai",
]);

export default function corsMiddleware() {
  return cors({
    origin: (origin, callback) => {
      // Requests like curl/postman/server-to-server often have no Origin
      if (!origin) return callback(null, true);

      if (allowedOrigins.has(origin)) return callback(null, true);

      return callback(
        new APIError({
          message: `'${origin}' is not allowed by CORS`,
          status: httpStatus.FORBIDDEN
        }),
        false
      );
    },
    credentials: false
  });
}

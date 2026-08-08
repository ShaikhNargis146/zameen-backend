import cors from "cors";
export default function corsMiddleware() {
  const allowedOrigins = new Set(
    String(process.env.CORS_ORIGINS || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );

  return cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      const error = new Error("CORS origin is not allowed");
      error.status = 403;
      error.code = "CORS_ORIGIN_DENIED";
      return callback(error);
    },
    credentials: true,
    maxAge: 86400
  });
}

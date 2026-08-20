import { rateLimit } from "express-rate-limit";

const message = (code, text) => ({
  success: false,
  error: { code, message: text }
});

export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: message("RATE_LIMITED", "Too many requests. Please try again later.")
});

export const mapRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: message(
    "MAP_RATE_LIMITED",
    "Too many map requests. Please try again shortly."
  )
});

export const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: message(
    "AI_RATE_LIMITED",
    "Too many AI requests. Please try again shortly."
  )
});

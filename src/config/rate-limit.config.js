import { rateLimit } from "express-rate-limit";

const message = (code, text) => ({
  success: false,
  error: { code, message: text }
});

// Razorpay's webhook deliveries are excluded from this pool (see
// express.config.js) and given their own budget below — Razorpay retries
// undelivered events from its own infrastructure, not end-user traffic, and
// a burst of retries sharing the general per-IP cap could get throttled
// alongside unrelated API callers on that IP or starve real users out of
// their own budget.
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

// Listing search accepts a free-text `search` term evaluated as a Postgres regex (~*) against
// every candidate row; it's more generous than mapRateLimit since it's the primary search path,
// but unauthenticated callers still need a cap so a cheap, valid-but-expensive pattern can't be
// replayed without limit.
export const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: message(
    "SEARCH_RATE_LIMITED",
    "Too many search requests. Please try again shortly."
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

// Dedicated budget for POST /payments/webhook, exempted from apiRateLimit
// above — a retry storm from Razorpay's own infrastructure must not compete
// with, or be capped by, ordinary user API traffic. Signature verification
// (see commerce.service.js handleWebhook) is still the real gate on this
// route; this limit is only a backstop against runaway volume.
export const paymentWebhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: message(
    "WEBHOOK_RATE_LIMITED",
    "Too many webhook requests. Please try again shortly."
  )
});

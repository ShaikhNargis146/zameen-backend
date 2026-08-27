import { HttpError } from "./http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Express router.param middleware for UUID route parameters. */
export const requireUuidParam = (req, _res, next, value, name) => {
  if (!uuidPattern.test(String(value || "")))
    return next(
      new HttpError(400, "INVALID_ID", `${name} must be a valid UUID.`)
    );
  return next();
};

export const isUuid = value => uuidPattern.test(String(value || ""));

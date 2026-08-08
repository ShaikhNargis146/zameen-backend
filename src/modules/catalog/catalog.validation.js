import { HttpError } from "../../shared/http.js";

export const searchQuery = query => {
  const value = String(query.q || "").trim();
  if (value.length < 2)
    throw new HttpError(
      400,
      "QUERY_TOO_SHORT",
      "q must contain at least two characters."
    );
  return value;
};

export const stateCode = value =>
  String(value || "")
    .trim()
    .toUpperCase();

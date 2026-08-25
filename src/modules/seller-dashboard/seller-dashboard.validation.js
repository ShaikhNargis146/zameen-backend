import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};

const optionalUuid = (value, field) =>
  value === undefined || value === null || value === "" ? null : uuid(value, field);

const optionalDate = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!datePattern.test(text))
    throw new HttpError(
      400,
      `INVALID_${field}`,
      `${field} must be a date in YYYY-MM-DD format.`
    );
  return text;
};

export const dashboardQuery = query => {
  const from = optionalDate(query.from, "FROM");
  const to = optionalDate(query.to, "TO");
  if (from && to && to < from)
    throw new HttpError(400, "INVALID_RANGE", "to must be on or after from.");
  return { from, to, organizationId: optionalUuid(query.organizationId, "organizationId") };
};

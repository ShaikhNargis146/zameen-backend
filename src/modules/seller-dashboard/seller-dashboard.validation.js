import { HttpError } from "../../shared/http.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const toField = code =>
  /^[A-Z0-9_]+$/.test(code) ? code.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()) : code;

export const uuid = (value, field) => {
  const text = String(value ?? "").trim();
  if (!uuidPattern.test(text)) {
    const message = `${field} must be a valid UUID.`;
    throw new HttpError(400, "INVALID_ID", message, [{ field: toField(field), message }]);
  }
  return text;
};

const optionalUuid = (value, field) =>
  value === undefined || value === null || value === "" ? null : uuid(value, field);

const optionalDate = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!datePattern.test(text)) {
    const message = `${field} must be a date in YYYY-MM-DD format.`;
    throw new HttpError(400, `INVALID_${field}`, message, [{ field: toField(field), message }]);
  }
  return text;
};

export const dashboardQuery = query => {
  const from = optionalDate(query.from, "FROM");
  const to = optionalDate(query.to, "TO");
  if (from && to && to < from)
    throw new HttpError(400, "INVALID_RANGE", "to must be on or after from.", [
      { field: "to", message: "to must be on or after from." }
    ]);
  return { from, to, organizationId: optionalUuid(query.organizationId, "organizationId") };
};

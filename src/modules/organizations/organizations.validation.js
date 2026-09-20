import { HttpError } from "../../shared/http.js";
import { toField } from "../../shared/validation.js";

const orgTypes = new Set(["BROKERAGE", "DEVELOPER", "CORPORATE", "AGENCY"]);
const orgStatuses = new Set(["PENDING", "ACTIVE", "SUSPENDED"]);
const memberRoles = new Set(["OWNER", "ADMIN", "MEMBER"]);
const e164Pattern = /^\+[1-9]\d{7,14}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const trimmed = value => String(value ?? "").trim();

const optionalPhone = value => {
  if (value === undefined || value === null || value === "") return null;
  const phone = trimmed(value);
  if (!e164Pattern.test(phone)) {
    const message = "phone must be a valid E.164 number.";
    throw new HttpError(400, "INVALID_PHONE", message, [{ field: "phone", message }]);
  }
  return phone;
};

const optionalEmail = value => {
  if (value === undefined || value === null || value === "") return null;
  const email = trimmed(value).toLowerCase();
  if (!emailPattern.test(email)) {
    const message = "email must be a valid email address.";
    throw new HttpError(400, "INVALID_EMAIL", message, [{ field: "email", message }]);
  }
  return email;
};

const optionalText = (value, max, code) => {
  if (value === undefined || value === null || value === "") return null;
  const text = trimmed(value);
  if (text.length > max) {
    const message = `${code} must be at most ${max} characters.`;
    throw new HttpError(400, `INVALID_${code}`, message, [{ field: toField(code), message }]);
  }
  return text;
};

const orgName = value => {
  const text = trimmed(value);
  if (text.length < 2 || text.length > 255) {
    const message = "name must be 2-255 characters.";
    throw new HttpError(400, "INVALID_NAME", message, [{ field: "name", message }]);
  }
  return text;
};

export const uuid = (value, field) => {
  const text = trimmed(value);
  if (!uuidPattern.test(text)) {
    const message = `${field} must be a valid UUID.`;
    throw new HttpError(400, "INVALID_ID", message, [{ field: toField(field), message }]);
  }
  return text;
};

export const createOrganization = body => {
  const type = trimmed(body.type).toUpperCase();
  if (!orgTypes.has(type)) {
    const message = "type must be BROKERAGE, DEVELOPER, CORPORATE, or AGENCY.";
    throw new HttpError(400, "INVALID_TYPE", message, [{ field: "type", message }]);
  }
  return {
    name: orgName(body.name),
    type,
    phone: optionalPhone(body.phone),
    email: optionalEmail(body.email),
    gstNumber: optionalText(body.gstNumber, 30, "GST_NUMBER"),
    reraNumber: optionalText(body.reraNumber, 100, "RERA_NUMBER"),
    logoStorageKey: body.logoStorageKey ? trimmed(body.logoStorageKey) : null
  };
};

export const updateOrganization = body => {
  const changes = {};
  if (Object.hasOwn(body, "name")) changes.name = orgName(body.name);
  if (Object.hasOwn(body, "phone")) changes.phone = optionalPhone(body.phone);
  if (Object.hasOwn(body, "email")) changes.email = optionalEmail(body.email);
  if (Object.hasOwn(body, "gstNumber"))
    changes.gst_number = optionalText(body.gstNumber, 30, "GST_NUMBER");
  if (Object.hasOwn(body, "reraNumber"))
    changes.rera_number = optionalText(body.reraNumber, 100, "RERA_NUMBER");
  if (Object.hasOwn(body, "logoStorageKey"))
    changes.logo_storage_key = body.logoStorageKey
      ? trimmed(body.logoStorageKey)
      : null;
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};

const optionalFilterText = (value, max) => {
  const text = trimmed(value);
  if (!text) return null;
  return text.slice(0, max);
};

const optionalEnumFilter = (value, set, code, label) => {
  const text = trimmed(value).toUpperCase();
  if (!text) return null;
  if (!set.has(text)) {
    const message = `${code} must be ${label}.`;
    throw new HttpError(400, `INVALID_${code}`, message, [{ field: toField(code), message }]);
  }
  return text;
};

export const listMineQuery = query => ({
  search: optionalFilterText(query.search, 255),
  name: optionalFilterText(query.name, 255),
  type: optionalEnumFilter(
    query.type,
    orgTypes,
    "TYPE",
    "BROKERAGE, DEVELOPER, CORPORATE, or AGENCY"
  ),
  slug: optionalFilterText(query.slug, 255),
  phone: optionalFilterText(query.phone, 20),
  email: optionalFilterText(query.email, 255)?.toLowerCase() ?? null,
  gstNumber: optionalFilterText(query.gstNumber, 30),
  reraNumber: optionalFilterText(query.reraNumber, 100),
  status: optionalEnumFilter(
    query.status,
    orgStatuses,
    "STATUS",
    "PENDING, ACTIVE, or SUSPENDED"
  ),
  role: optionalEnumFilter(query.role, memberRoles, "ROLE", "OWNER, ADMIN, or MEMBER")
});

export const organizationStatus = body => {
  const status = trimmed(body.status).toUpperCase();
  if (!orgStatuses.has(status)) {
    const message = "status must be PENDING, ACTIVE, or SUSPENDED.";
    throw new HttpError(400, "INVALID_STATUS", message, [{ field: "status", message }]);
  }
  return status;
};

export const addMember = body => {
  const userId = uuid(body.userId, "userId");
  const role = trimmed(body.role).toUpperCase();
  if (!memberRoles.has(role)) {
    const message = "role must be OWNER, ADMIN, or MEMBER.";
    throw new HttpError(400, "INVALID_ROLE", message, [{ field: "role", message }]);
  }
  return { userId, role };
};

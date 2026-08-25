import { HttpError } from "../../shared/http.js";

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
  if (!e164Pattern.test(phone))
    throw new HttpError(
      400,
      "INVALID_PHONE",
      "phone must be a valid E.164 number."
    );
  return phone;
};

const optionalEmail = value => {
  if (value === undefined || value === null || value === "") return null;
  const email = trimmed(value).toLowerCase();
  if (!emailPattern.test(email))
    throw new HttpError(
      400,
      "INVALID_EMAIL",
      "email must be a valid email address."
    );
  return email;
};

const optionalText = (value, max, code) => {
  if (value === undefined || value === null || value === "") return null;
  const text = trimmed(value);
  if (text.length > max)
    throw new HttpError(
      400,
      `INVALID_${code}`,
      `${code} must be at most ${max} characters.`
    );
  return text;
};

const orgName = value => {
  const text = trimmed(value);
  if (text.length < 2 || text.length > 255)
    throw new HttpError(400, "INVALID_NAME", "name must be 2-255 characters.");
  return text;
};

export const uuid = (value, field) => {
  const text = trimmed(value);
  if (!uuidPattern.test(text))
    throw new HttpError(400, "INVALID_ID", `${field} must be a valid UUID.`);
  return text;
};

export const createOrganization = body => {
  const type = trimmed(body.type).toUpperCase();
  if (!orgTypes.has(type))
    throw new HttpError(
      400,
      "INVALID_TYPE",
      "type must be BROKERAGE, DEVELOPER, CORPORATE, or AGENCY."
    );
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
  if (!set.has(text))
    throw new HttpError(400, `INVALID_${code}`, `${code} must be ${label}.`);
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
  if (!orgStatuses.has(status))
    throw new HttpError(
      400,
      "INVALID_STATUS",
      "status must be PENDING, ACTIVE, or SUSPENDED."
    );
  return status;
};

export const addMember = body => {
  const userId = uuid(body.userId, "userId");
  const role = trimmed(body.role).toUpperCase();
  if (!memberRoles.has(role))
    throw new HttpError(
      400,
      "INVALID_ROLE",
      "role must be OWNER, ADMIN, or MEMBER."
    );
  return { userId, role };
};

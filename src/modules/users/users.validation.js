import { HttpError } from "../../shared/http.js";

const statuses = new Set(["ACTIVE", "BLOCKED"]);
const languages = new Set(["en", "hi", "mr", "gu", "pa", "te", "ta"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nullableText = (value, field, max) => {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (text.length > max)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${field} must be at most ${max} characters.`
    );
  return text;
};

export const profileChanges = body => {
  const changes = {};
  if (Object.hasOwn(body, "displayName")) {
    const name = String(body.displayName || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name)
      throw new HttpError(400, "INVALID_NAME", "Name cannot be empty.");
    if (name.length > 200)
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "displayName must be at most 200 characters."
      );
    changes.display_name = name;
  }
  if (Object.hasOwn(body, "firstName"))
    changes.first_name = nullableText(body.firstName, "firstName", 100);
  if (Object.hasOwn(body, "lastName"))
    changes.last_name = nullableText(body.lastName, "lastName", 100);
  if (Object.hasOwn(body, "email")) {
    const email = nullableText(body.email, "email", 255);
    if (email && !emailPattern.test(email))
      throw new HttpError(400, "INVALID_EMAIL", "email must be valid.");
    changes.email = email?.toLowerCase() || null;
  }
  if (Object.hasOwn(body, "preferredLanguage")) {
    const language = String(body.preferredLanguage || "").trim();
    if (!languages.has(language))
      throw new HttpError(
        400,
        "INVALID_LANGUAGE",
        "preferredLanguage must be a language code."
      );
    changes.preferred_language = language;
  }
  if (!Object.keys(changes).length)
    throw new HttpError(400, "NO_CHANGES", "No editable fields were supplied.");
  return changes;
};

export const selfRole = body => {
  // `roleCode` is the integration-contract name. Keep `role` temporarily for
  // clients built against the earlier implementation.
  const role = String(body.roleCode || body.role || "").toUpperCase();
  if (
    ![
      "BUYER",
      "SELLER",
      "BROKER",
      "DEVELOPER",
      "CHANNEL_PARTNER",
      "CORPORATE"
    ].includes(role)
  )
    throw new HttpError(
      400,
      "ROLE_NOT_SELF_ASSIGNABLE",
      "Only non-administrator roles may be self-assigned."
    );
  return role;
};

export const userStatus = body => {
  const status = String(body.status || "").toUpperCase();
  if (!statuses.has(status))
    throw new HttpError(
      400,
      "INVALID_STATUS",
      "status must be ACTIVE or BLOCKED."
    );
  return { status, reason: nullableText(body.reason, "reason", 500) };
};

export const roles = body => {
  const result = Array.isArray(body.roles)
    ? [...new Set(body.roles.map(role => String(role).toUpperCase()))]
    : [];
  if (!result.length)
    throw new HttpError(
      400,
      "ROLES_REQUIRED",
      "roles must be a non-empty array."
    );
  return {
    roleCodes: result,
    reason: nullableText(body.reason, "reason", 500)
  };
};

export const adminListQuery = query => {
  const status = query.status ? String(query.status).toUpperCase() : null;
  if (status && !statuses.has(status))
    throw new HttpError(400, "INVALID_STATUS", "Invalid user status.");
  return {
    page: Math.max(Number(query.page || 1), 1),
    limit: Math.min(Math.max(Number(query.limit || 20), 1), 100),
    search: nullableText(query.search, "search", 200),
    status,
    role: query.role ? String(query.role).toUpperCase() : null
  };
};

import { HttpError } from "../../shared/http.js";

const statuses = new Set(["ACTIVE", "BLOCKED", "DELETED"]);

export const profileChanges = body => {
  const changes = {};
  if (Object.hasOwn(body, "name")) {
    const name = String(body.name || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!name)
      throw new HttpError(400, "INVALID_NAME", "Name cannot be empty.");
    changes.display_name = name;
  }
  if (Object.hasOwn(body, "email"))
    changes.email = body.email
      ? String(body.email)
          .trim()
          .toLowerCase()
      : null;
  if (Object.hasOwn(body, "preferredLanguage")) {
    const language = String(body.preferredLanguage || "").trim();
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(language))
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
  const role = String(body.role || "").toUpperCase();
  if (!["BUYER", "SELLER"].includes(role))
    throw new HttpError(
      400,
      "ROLE_NOT_SELF_ASSIGNABLE",
      "Only BUYER and SELLER may be self-assigned."
    );
  return role;
};

export const userStatus = body => {
  const status = String(body.status || "").toUpperCase();
  if (!statuses.has(status))
    throw new HttpError(
      400,
      "INVALID_STATUS",
      "status must be ACTIVE, BLOCKED, or DELETED."
    );
  return status;
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
  return result;
};

export const adminListQuery = query => {
  const status = query.status ? String(query.status).toUpperCase() : null;
  if (status && !statuses.has(status))
    throw new HttpError(400, "INVALID_STATUS", "Invalid user status.");
  return {
    limit: Math.min(Math.max(Number(query.limit || 50), 1), 100),
    offset: Math.max(Number(query.offset || 0), 0),
    search: String(query.search || "").trim() || null,
    status
  };
};

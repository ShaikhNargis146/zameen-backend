import pg from "../../utils/postgres_store.js";
import response_handler from "../../middlewares/response_handler.js";
import logger from "../../utils/logger.js";

const normalizePhone = v => {
  const p = String(v || "")
    .replace(/\D/g, "")
    .slice(0, 10);
  return /^\d{10}$/.test(p) ? p : null;
};

const USER_SCOPES = Object.freeze({
  admin: {
    isInternal: true,
    roles: ["admin", "super_admin"],
    canCreate: actor => actor?.role === "super_admin",
    canSetStatus: actor => actor?.role === "super_admin"
  },
  app: {
    isInternal: false,
    roles: ["user", "agent", "org_admin", "org_member"],
    canCreate: actor => ["admin", "super_admin"].includes(actor?.role),
    canSetStatus: actor => ["admin", "super_admin"].includes(actor?.role)
  }
});

const USER_STATUSES = ["active", "inactive", "blocked"];

const getScopeConfig = scope => USER_SCOPES[scope] || null;

const buildRoleFilterSql = roles => roles.map(r => `'${r}'`).join(",");

class UsersService {
  static list = async ({
    scope,
    limit = 50,
    offset = 0,
    search = null,
    role = null,
    status = null,
    org_id = null
  }) => {
    try {
      const cfg = getScopeConfig(scope);
      if (!cfg) return response_handler.invalid({ message: "invalid scope" });

      const whereParts = [
        `is_internal = ${cfg.isInternal}`,
        `role IN (${buildRoleFilterSql(cfg.roles)})`
      ];
      const params = { limit, offset };

      if (role) {
        whereParts.push("role = ${role}");
        params.role = role;
      }

      if (status) {
        whereParts.push("status = ${status}");
        params.status = status;
      }

      if (scope === "app" && org_id) {
        whereParts.push("org_id = ${org_id}");
        params.org_id = org_id;
      }

      if (search) {
        whereParts.push(
          "(name ILIKE ${search} OR phone ILIKE ${search} OR email ILIKE ${search})"
        );
        params.search = `%${search}%`;
      }

      const r = await pg.list({
        table: "app_user",
        where: whereParts.join(" AND "),
        params,
        orderKey: "newest",
        limit,
        offset
      });

      if (!r.ok) return response_handler.errorHandler("Internal_Server_Error");

      return response_handler.success({
        list: r.data.rows,
        total_count: r.data.count
      });
    } catch (err) {
      logger.error("error in users.list", err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  };

  static create = async ({ scope, data, actor }) => {
    try {
      const cfg = getScopeConfig(scope);
      if (!cfg) return response_handler.invalid({ message: "invalid scope" });
      if (!cfg.canCreate(actor)) {
        return { status: 403, ok: false, message: "FORBIDDEN" };
      }

      const phone = normalizePhone(data?.phone);
      const name = String(data?.name || "").trim();
      const email = data?.email?.trim() || null;
      const role = data?.role || cfg.roles[0];
      const status = data?.status || "active";
      const org_id = scope === "app" ? data?.org_id || null : null;

      if (!name)
        return response_handler.invalid({ message: "name is required" });
      if (!phone)
        return response_handler.invalid({ message: "valid phone is required" });
      if (!cfg.roles.includes(role)) {
        return response_handler.invalid({ message: "invalid role" });
      }
      if (!USER_STATUSES.includes(status)) {
        return response_handler.invalid({ message: "invalid status" });
      }

      if (scope === "app") {
        if (["org_admin", "org_member"].includes(role) && !org_id) {
          return response_handler.invalid({
            message: "org_id is required for organization users"
          });
        }
        if (!["org_admin", "org_member"].includes(role) && org_id) {
          return response_handler.invalid({
            message: "org_id is only allowed for organization users"
          });
        }
      }

      const existing = await pg.oneOrNone(
        `
        SELECT id, is_internal, role
        FROM app_user
        WHERE phone = $1
        `,
        [phone]
      );

      if (existing?.ok && existing.data) {
        return { status: 409, ok: false, message: "Phone already exists" };
      }

      const r = await pg.insertOne({
        table: "app_user",
        columns: [
          "name",
          "phone",
          "email",
          "role",
          "is_internal",
          "status",
          "org_id",
          "created_by",
          "updated_by"
        ],
        values: {
          name,
          phone,
          email,
          role,
          is_internal: cfg.isInternal,
          status,
          org_id,
          created_by: actor.id || null,
          updated_by: actor.id || null
        },
        returning: "id"
      });

      if (!r.ok) {
        if (String(r.error?.code) === "23505") {
          return { status: 409, ok: false, message: "Phone already exists" };
        }
        return response_handler.errorHandler("Internal_Server_Error");
      }

      return response_handler.success({ id: r.data.id });
    } catch (err) {
      logger.error("error in users.create", err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  };

  static setStatus = async ({ scope, id, status, actor }) => {
    try {
      const cfg = getScopeConfig(scope);
      if (!cfg) return response_handler.invalid({ message: "invalid scope" });
      if (!cfg.canSetStatus(actor)) {
        return { status: 403, ok: false, message: "FORBIDDEN" };
      }

      if (!id) return response_handler.invalid({ message: "id is required" });
      if (!USER_STATUSES.includes(status)) {
        return response_handler.invalid({
          message: "status must be active|blocked|inactive"
        });
      }

      if (scope === "admin" && actor.id === id && status !== "active") {
        return response_handler.invalid({
          message: "You cannot block/inactivate your own account."
        });
      }

      const r = await pg.updateWhere({
        table: "app_user",
        set: {
          status,
          updated_by: actor.id || null,
          updated_at: new Date()
        },
        where: `id = \${id} AND is_internal = ${
          cfg.isInternal
        } AND role IN (${buildRoleFilterSql(cfg.roles)})`,
        params: { id },
        returning: "id, name, phone, role, status, org_id"
      });

      if (!r.ok)
        return response_handler.invalid({ message: "No record found!" });

      if (status === "blocked" || status === "inactive") {
        try {
          await pg.none(
            `UPDATE auth_session SET revoked_at = now()
             WHERE user_id = $1 AND revoked_at IS NULL`,
            [id]
          );
        } catch {}
      }

      return response_handler.success(r.data);
    } catch (err) {
      logger.error("error in users.setStatus", err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  };

  static summary = async () => {
    try {
      const q = `
        SELECT
          (SELECT COUNT(*)::int FROM app_user WHERE is_internal = true) AS admin_count,
          (SELECT COUNT(*)::int FROM app_user WHERE is_internal = false) AS app_user_count,
          (SELECT COUNT(*)::int FROM app_user WHERE role = 'agent') AS agent_count,
          (SELECT COUNT(*)::int FROM org) AS org_count,
          (SELECT COUNT(*)::int FROM listing) AS listing_count,
          (SELECT COUNT(*)::int FROM listing WHERE status = 'live') AS live_listing_count,
          (SELECT COUNT(*)::int FROM inquiry) AS inquiry_count,
          (SELECT COUNT(*)::int FROM ad_campaign) AS ad_campaign_count
      `;

      const r = await pg.one(q, {});
      if (!r.ok) return response_handler.errorHandler("Internal_Server_Error");

      return response_handler.success(r.data);
    } catch (err) {
      logger.error("error in users.summary", err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  };
}

export default UsersService;

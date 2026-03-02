import pg from "../../utils/postgres_store.js";
import response_handler from "../../middlewares/response_handler.js";
import logger from "../../utils/logger.js";

const normalizePhone = v => {
  const p = String(v || "")
    .replace(/\D/g, "")
    .slice(0, 10);
  return /^\d{10}$/.test(p) ? p : null;
};

const APP_ROLES = ["user", "agent", "org_admin", "org_member"];
const APP_STATUSES = ["active", "inactive", "blocked"];

class AppUsersService {
  static list = async ({
    limit = 50,
    offset = 0,
    search = null,
    role = null,
    status = null,
    org_id = null
  }) => {
    try {
      const whereParts = [
        "is_internal = false",
        "role IN ('user','agent','org_admin','org_member')"
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

      if (org_id) {
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
      logger.error("error in appUsers.list", err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  };

  static create = async ({ data, actor }) => {
    try {
      if (!actor || !["admin", "super_admin"].includes(actor.role)) {
        return { status: 403, ok: false, message: "FORBIDDEN" };
      }

      const phone = normalizePhone(data?.phone);
      const name = String(data?.name || "").trim();
      const email = data?.email?.trim() || null;
      const role = data?.role || "user";
      const status = data?.status || "active";
      const org_id = data?.org_id || null;

      if (!name)
        return response_handler.invalid({ message: "name is required" });
      if (!phone)
        return response_handler.invalid({ message: "valid phone is required" });
      if (!APP_ROLES.includes(role)) {
        return response_handler.invalid({ message: "invalid role" });
      }
      if (!APP_STATUSES.includes(status)) {
        return response_handler.invalid({ message: "invalid status" });
      }
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

      const existing = await pg.oneOrNone(
        `
        SELECT id
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
          is_internal: false,
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
      logger.error("error in appUsers.create", err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  };

  static setStatus = async ({ id, status, actor }) => {
    try {
      if (!actor || !["admin", "super_admin"].includes(actor.role)) {
        return { status: 403, ok: false, message: "FORBIDDEN" };
      }

      if (!id) return response_handler.invalid({ message: "id is required" });
      if (!APP_STATUSES.includes(status)) {
        return response_handler.invalid({
          message: "status must be active|blocked|inactive"
        });
      }

      const r = await pg.updateWhere({
        table: "app_user",
        set: {
          status,
          updated_by: actor.id || null,
          updated_at: new Date()
        },
        where:
          "id = ${id} AND is_internal = false AND role IN ('user','agent','org_admin','org_member')",
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
      logger.error("error in appUsers.setStatus", err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  };
}

export default AppUsersService;

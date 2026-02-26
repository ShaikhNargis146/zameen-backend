import db from "../../utils/postgres_store.js";

const ok = data => ({ ok: true, data, error: null });
const fail = error => ({ ok: false, data: null, error });

const normalizePhone = v =>
  String(v || "")
    .replace(/\D/g, "")
    .slice(-10);
const validPhone = v => /^\d{10}$/.test(v);

const AdminUsersService = {
  createAdmin: async ({ actor, full_name, phone, email }) => {
    try {
      if (actor?.role !== "admin") return fail(new Error("Forbidden"));

      const p = normalizePhone(phone);
      if (!validPhone(p)) return fail(new Error("Invalid phone"));
      if (!full_name || String(full_name).trim().length < 2)
        return fail(new Error("Invalid name"));

      // prevent duplicate by phone
      const existing = await db.oneOrNone(
        `SELECT id, role FROM app_user WHERE phone=$1`,
        [p]
      );
      if (existing) {
        // if user exists, just promote to admin
        const updated = await db.one(
          `UPDATE app_user SET role='admin', is_active=true
           WHERE id=$1
           RETURNING id, full_name, phone, email, role, is_active`,
          [existing.id]
        );
        return ok(updated);
      }

      const row = await db.one(
        `INSERT INTO app_user (full_name, phone, email, role, is_active, created_by)
         VALUES ($1, $2, $3, 'admin', true, $4)
         RETURNING id, full_name, phone, email, role, is_active, created_at`,
        [full_name.trim(), p, email || null, actor.id]
      );

      return ok(row);
    } catch (e) {
      return fail(e);
    }
  }
};

export default AdminUsersService;

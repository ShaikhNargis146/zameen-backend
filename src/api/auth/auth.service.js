import jwt from "jsonwebtoken";
import db from "../../config/postgres.config.js";

const SECRET_KEY = process.env.JWT_SECRET || "your-secret-key";
const OTP_CODE = process.env.HARDCODED_OTP || "123456";

const ok = data => ({ ok: true, data, error: null });
const fail = error => ({ ok: false, data: null, error });

const normalizePhone = v =>
  String(v || "")
    .replace(/\D/g, "")
    .slice(-10);
const validPhone = v => /^\d{10}$/.test(v);

const AuthService = {
  // Optional: pretend OTP send
  requestOtp: async ({ phone }) => {
    try {
      const p = normalizePhone(phone);
      if (!validPhone(p)) return fail(new Error("Invalid phone"));

      // In Phase-1 we do not send SMS; we "simulate"
      return ok({
        phone: p,
        otp_hint: "Use hardcoded OTP for POC"
      });
    } catch (e) {
      return fail(e);
    }
  },

  login: async ({ phone, otp, role }) => {
    try {
      const p = normalizePhone(phone);
      if (!validPhone(p)) return fail(new Error("Invalid phone"));

      if (String(otp || "") !== OTP_CODE) return fail(new Error("Invalid OTP"));

      // find existing user by phone
      let user = await db.oneOrNone(
        `SELECT id, full_name, phone, email, role, is_active, org_id
         FROM app_user
         WHERE phone=$1`,
        [p]
      );

      // If user does not exist, create as user by default (simple)
      if (!user) {
        user = await db.one(
          `INSERT INTO app_user (full_name, phone, role, is_active)
           VALUES ($1, $2, 'user', true)
           RETURNING id, full_name, phone, email, role, is_active, org_id`,
          ["User", p]
        );
      }

      if (!user.is_active) return fail(new Error("User is inactive"));

      // Optional enforcement: if caller says role=admin, require actual admin
      if (role === "admin" && user.role !== "admin") {
        return fail(new Error("Not an admin user"));
      }

      // JWT payload (keep small)
      const token = jwt.sign(
        { id: user.id, role: user.role, phone: user.phone },
        SECRET_KEY,
        { expiresIn: "30d" }
      );

      return ok({
        token,
        user: {
          id: user.id,
          full_name: user.full_name,
          phone: user.phone,
          email: user.email,
          role: user.role,
          org_id: user.org_id
        }
      });
    } catch (e) {
      return fail(e);
    }
  },

  me: async ({ user }) => {
    try {
      // user is from JWT
      const row = await db.oneOrNone(
        `SELECT id, full_name, phone, email, role, is_active, org_id, created_at
         FROM app_user
         WHERE id=$1`,
        [user.id]
      );
      return ok(row);
    } catch (e) {
      return fail(e);
    }
  }
};

export default AuthService;

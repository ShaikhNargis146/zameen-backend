import pg from "../../utils/postgres_store.js";
import redis from "../../config/redis.js";
import response_handler from "../../middlewares/response_handler.js";
import logger from "../../utils/logger.js";
import {
  hashWithPepper,
  randomToken,
  safeEqualHex
} from "../../utils/crypto.js";

const OTP_MODE =
  process.env.OTP_MODE ||
  (process.env.NODE_ENV === "production" ? "disabled" : "static");
const DEFAULT_DEV_OTP = "123456";

const normalizePhone = v => {
  const p = String(v || "")
    .replace(/\D/g, "")
    .slice(0, 10);
  return /^\d{10}$/.test(p) ? p : null;
};

const normalizeName = v => {
  const name = String(v || "")
    .trim()
    .replace(/\s+/g, " ");
  return name || null;
};

const nowPlusDays = days => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

// scope = "admin" | "user"
const makeKeys = ({ scope, phone, ip }) => ({
  otp: `otp:${scope}:${phone}`,
  otpTry: `otp:try:${scope}:${phone}`,
  cooldown: `otp:cooldown:${scope}:${phone}`,
  rlPhone: `otp:rl:phone:${scope}:${phone}`,
  rlIp: ip ? `otp:rl:ip:${scope}:${ip}` : null
});

const cfgForScope = scope => {
  // separate env allows different rate limits for admin vs user
  const prefix = scope === "admin" ? "ADMIN" : "USER";

  return {
    otpTtl: Number(process.env[`${prefix}_OTP_TTL_SEC`] || 300),
    cooldown: Number(process.env[`${prefix}_OTP_COOLDOWN_SEC`] || 60),
    maxTries: Number(process.env[`${prefix}_OTP_MAX_TRIES`] || 50),
    rlPhone: Number(process.env[`${prefix}_RL_PHONE_10MIN`] || 50),
    rlIp: Number(process.env[`${prefix}_RL_IP_10MIN`] || 20),
    sessionDays: Number(process.env[`${prefix}_SESSION_TTL_DAYS`] || 14),
    tokenPrefix: scope === "admin" ? "admin_access" : "user_access",
    rollingSession:
      String(
        process.env[`${prefix}_SESSION_ROLLING_ENABLED`] ||
          (scope === "user" ? "true" : "false")
      ).toLowerCase() === "true",
    rollingThresholdSec: Number(
      process.env[`${prefix}_SESSION_ROLLING_THRESHOLD_SEC`] || 86400
    )
  };
};

const rulesForScope = scope => {
  if (scope === "admin") {
    return { is_internal: true, roles: ["super_admin", "admin"] };
  }
  return {
    is_internal: false,
    roles: ["user", "agent", "org_admin", "org_member"]
  };
};

const getStaticOtp = () => {
  if (OTP_MODE !== "static") return null;

  if (process.env.AUTH_STATIC_OTP) return process.env.AUTH_STATIC_OTP;
  if (process.env.NODE_ENV !== "production") return DEFAULT_DEV_OTP;

  return null;
};

const canSelfProvision = scope => scope === "user";

class AuthService {
  static async _findUserByPhone({ phone }) {
    const r = await pg.getOne({
      table: "app_user",
      where: "phone = ${phone}",
      params: { phone }
    });

    if (!r.ok) return null;
    return r.data;
  }

  static _isEligibleForScope({ user, scope }) {
    if (!user) return false;

    const rule = rulesForScope(scope);

    if (user.status !== "active") return false;
    if (Boolean(user.is_internal) !== Boolean(rule.is_internal)) return false;
    if (!rule.roles.includes(user.role)) return false;

    return true;
  }

  static async _getUserByPhone({ phone, scope }) {
    const user = await this._findUserByPhone({ phone });
    return this._isEligibleForScope({ user, scope }) ? user : null;
  }

  static async _provisionUserForScope({ phone, scope, name = null }) {
    if (!canSelfProvision(scope)) return null;

    const displayName = normalizeName(name) || `User ${phone.slice(-4)}`;
    const created = await pg.insertOne({
      table: "app_user",
      columns: ["name", "phone", "role", "is_internal", "status"],
      values: {
        name: displayName,
        phone,
        role: "user",
        is_internal: false,
        status: "active"
      },
      returning: "id, name, phone, role, is_internal, status"
    });

    if (!created.ok) {
      if (String(created.error?.code) === "23505") {
        return this._getUserByPhone({ phone, scope });
      }
      return null;
    }

    return created.data;
  }

  static async requestOtp({ scope, phone, ip = null }) {
    try {
      const cfg = cfgForScope(scope);
      const p = normalizePhone(phone);
      const staticOtp = getStaticOtp();

      if (!staticOtp) {
        logger.error(`OTP mode is not configured for scope=${scope}`);
        return { status: 503, message: "OTP_SERVICE_UNAVAILABLE" };
      }

      if (!p) return response_handler.success({ cooldown_sec: cfg.cooldown });

      const k = makeKeys({ scope, phone: p, ip });

      const cooldownTtl = await redis.ttl(k.cooldown);
      if (cooldownTtl > 0)
        return response_handler.success({ cooldown_sec: cooldownTtl });

      // rate limit phone
      const phoneCount = await redis.incr(k.rlPhone);
      if (phoneCount === 1) await redis.expire(k.rlPhone, 600);
      if (phoneCount > cfg.rlPhone)
        return { status: 429, message: "RATE_LIMIT_PHONE" };

      // rate limit ip
      if (k.rlIp) {
        const ipCount = await redis.incr(k.rlIp);
        if (ipCount === 1) await redis.expire(k.rlIp, 600);
        if (ipCount > cfg.rlIp)
          return { status: 429, message: "RATE_LIMIT_IP" };
      }

      const existingUser = await this._findUserByPhone({ phone: p });
      const shouldIssueOtp =
        this._isEligibleForScope({ user: existingUser, scope }) ||
        (!existingUser && canSelfProvision(scope));

      // only set otp if eligible for login/signup (generic response always)
      if (shouldIssueOtp) {
        const otpHash = hashWithPepper(`${scope}:${p}:${staticOtp}`);
        await redis.set(k.otp, otpHash, "EX", cfg.otpTtl);
        await redis.del(k.otpTry);
        await redis.set(k.cooldown, "1", "EX", cfg.cooldown);
      }

      return response_handler.success({ cooldown_sec: cfg.cooldown });
    } catch (err) {
      logger.error(`error in auth.requestOtp scope=${scope}`, err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  }

  static async verifyOtp({
    scope,
    phone,
    otp,
    ip = null,
    user_agent = null,
    name = null
  }) {
    try {
      const cfg = cfgForScope(scope);
      const p = normalizePhone(phone);
      const staticOtp = getStaticOtp();

      if (!staticOtp)
        return { status: 503, message: "OTP_SERVICE_UNAVAILABLE" };
      if (!p) return response_handler.invalid({ message: "Invalid phone/otp" });

      const existingUser = await this._findUserByPhone({ phone: p });
      if (
        existingUser &&
        !this._isEligibleForScope({ user: existingUser, scope })
      ) {
        return response_handler.invalid({ message: "Invalid phone/otp" });
      }

      if (!existingUser && !canSelfProvision(scope)) {
        return response_handler.invalid({ message: "Invalid phone/otp" });
      }

      const k = makeKeys({ scope, phone: p, ip });

      const tries = await redis.incr(k.otpTry);
      if (tries === 1) await redis.expire(k.otpTry, cfg.otpTtl);
      if (tries > cfg.maxTries)
        return { status: 429, message: "OTP_MAX_TRIES" };

      const stored = await redis.get(k.otp);
      if (!stored) return { status: 410, message: "OTP_EXPIRED" };

      const attemptHash = hashWithPepper(`${scope}:${p}:${String(otp || "")}`);
      if (!safeEqualHex(stored, attemptHash))
        return response_handler.invalid({ message: "Invalid phone/otp" });

      await redis.del(k.otp);
      await redis.del(k.otpTry);

      const user =
        existingUser ||
        (await this._provisionUserForScope({ phone: p, scope, name }));

      if (!user)
        return response_handler.errorHandler("Unable to provision user");

      const accessToken = randomToken(32);
      const tokenHash = hashWithPepper(`${cfg.tokenPrefix}:${accessToken}`);
      const expiresAt = nowPlusDays(cfg.sessionDays);

      const sess = await pg.one(
        `
        INSERT INTO auth_session (user_id, token_hash, expires_at, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, user_id, expires_at
        `,
        [user.id, tokenHash, expiresAt, ip, user_agent]
      );

      if (!sess.ok)
        return response_handler.errorHandler("Internal_Server_Error");

      // best-effort login meta
      try {
        await pg.none(
          `
          UPDATE app_user
          SET last_login_at = now(),
              last_login_ip = $2,
              last_login_user_agent = $3,
              updated_at = now()
          WHERE id = $1
          `,
          [user.id, ip, user_agent]
        );
      } catch {}

      return response_handler.success({
        token: accessToken,
        expires_at: expiresAt,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role
        }
      });
    } catch (err) {
      logger.error(`error in auth.verifyOtp scope=${scope}`, err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  }

  static async me({ scope, token }) {
    try {
      if (!token) return { status: 401, message: "UNAUTHORIZED" };

      const cfg = cfgForScope(scope);
      const rule = rulesForScope(scope);
      const tokenHash = hashWithPepper(`${cfg.tokenPrefix}:${token}`);

      const r = await pg.one(
        `
        SELECT
          s.id as session_id, s.expires_at, s.revoked_at,
          u.id as user_id, u.name, u.phone, u.role, u.is_internal, u.status
        FROM auth_session s
        JOIN app_user u ON u.id = s.user_id
        WHERE s.token_hash = $1
        `,
        [tokenHash]
      );

      if (!r.ok) return { status: 401, message: "UNAUTHORIZED" };

      const row = r.data;

      if (row.revoked_at) return { status: 401, message: "UNAUTHORIZED" };
      if (row.status !== "active")
        return { status: 401, message: "UNAUTHORIZED" };

      if (Boolean(row.is_internal) !== Boolean(rule.is_internal))
        return { status: 403, message: "FORBIDDEN" };
      if (!rule.roles.includes(row.role))
        return { status: 403, message: "FORBIDDEN" };

      const expiresAtMs = new Date(row.expires_at).getTime();
      if (expiresAtMs < Date.now())
        return { status: 401, message: "UNAUTHORIZED" };

      let effectiveExpiresAt = row.expires_at;
      const shouldRoll =
        cfg.rollingSession &&
        expiresAtMs - Date.now() <= cfg.rollingThresholdSec * 1000;

      if (shouldRoll) {
        const nextExpiresAt = nowPlusDays(cfg.sessionDays);
        const refreshed = await pg.one(
          `
          UPDATE auth_session
          SET expires_at = $2
          WHERE id = $1
            AND revoked_at IS NULL
            AND expires_at > now()
          RETURNING expires_at
          `,
          [row.session_id, nextExpiresAt]
        );

        if (refreshed.ok && refreshed.data?.expires_at) {
          effectiveExpiresAt = refreshed.data.expires_at;
        } else if (!refreshed.ok) {
          logger.error(
            `error in auth.me rolling session scope=${scope}`,
            refreshed.error
          );
        }
      }

      return response_handler.success({
        user: {
          id: row.user_id,
          name: row.name,
          phone: row.phone,
          role: row.role
        },
        session: { id: row.session_id, expires_at: effectiveExpiresAt }
      });
    } catch (err) {
      logger.error(`error in auth.me scope=${scope}`, err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  }

  static async logout({ scope, token }) {
    try {
      if (!token) return response_handler.success({});

      const cfg = cfgForScope(scope);
      const tokenHash = hashWithPepper(`${cfg.tokenPrefix}:${token}`);

      await pg.none(
        `
        UPDATE auth_session
        SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
        `,
        [tokenHash]
      );

      return response_handler.success({});
    } catch (err) {
      logger.error(`error in auth.logout scope=${scope}`, err);
      return response_handler.errorHandler("Internal_Server_Error");
    }
  }
}

export default AuthService;

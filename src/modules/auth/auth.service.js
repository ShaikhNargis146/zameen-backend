import jwt from "jsonwebtoken";
import {
  hashWithPepper,
  randomToken,
  safeEqualHex
} from "../../utils/crypto.js";
import * as repository from "./auth.repository.js";

const accessTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900);
const refreshTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const otpTtlSeconds = Number(process.env.OTP_TTL_SECONDS || 300);
const otpMaxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const otpResendAfterSeconds = Number(
  process.env.OTP_RESEND_AFTER_SECONDS || 30
);
const otpRateLimitPerIp = Number(process.env.OTP_RATE_LIMIT_PER_IP_10MIN || 20);
const otpPurposes = new Set([
  "LOGIN",
  "REGISTER",
  "VERIFY_PHONE",
  "VERIFY_EMAIL"
]);
const staticOtp =
  process.env.NODE_ENV !== "production"
    ? process.env.AUTH_STATIC_OTP || "1234"
    : null;
const jwtSecret = process.env.JWT_SECRET || "development-only-change-me";
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET)
  throw new Error("JWT_SECRET is required in production");

export const phoneE164 = input => {
  const raw = String(input || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return /^\+\d{8,15}$/.test(raw) ? raw : null;
};
export const rolesFor = repository.rolesForUser;
const destinationFor = ({ phone, email }) => {
  const normalizedPhone = phoneE164(phone);
  return {
    destination:
      normalizedPhone ||
      String(email || "")
        .trim()
        .toLowerCase(),
    channel: normalizedPhone ? "SMS" : email ? "EMAIL" : null
  };
};
const responseError = (status, code, message) => ({
  ok: false,
  status,
  code,
  message
});
const signAccessToken = ({ userId, sessionId, roles }) =>
  jwt.sign({ sub: userId, sid: sessionId, roles }, jwtSecret, {
    expiresIn: accessTtlSeconds,
    issuer: "zameens-api",
    audience: "zameens-app"
  });
const displayName = ({ name, destination }) =>
  String(name || "")
    .trim()
    .replace(/\s+/g, " ") || `User ${destination.slice(-4)}`;
const maskDestination = ({ destination, channel }) => {
  if (channel === "SMS")
    return `${destination.slice(0, 3)}******${destination.slice(-4)}`;
  const [name, domain] = destination.split("@");
  return `${name.slice(0, 2)}***@${domain || ""}`;
};
const userSummary = (user, roles) => ({
  id: user.id,
  firstName: user.first_name || null,
  lastName: user.last_name || null,
  displayName: user.display_name,
  phoneE164: user.phone_e164,
  email: user.email,
  avatarUrl: user.avatar_storage_key || null,
  roles,
  status: user.status,
  preferredLanguage: user.preferred_language
});

class AuthService {
  static async requestOtp(input) {
    const purpose = String(input.purpose || "LOGIN").toUpperCase();
    if (!otpPurposes.has(purpose))
      return responseError(400, "INVALID_OTP_PURPOSE", "Invalid OTP purpose.");
    const { destination, channel } = destinationFor(input);
    if (!destination || !channel)
      return responseError(
        400,
        "INVALID_DESTINATION",
        "Provide a valid phone or email."
      );
    if (!staticOtp)
      return responseError(
        503,
        "OTP_PROVIDER_UNCONFIGURED",
        "OTP service is unavailable."
      );
    const [recentForDestination, recentForIp, latest] = await Promise.all([
      repository.countRecentChallenges(destination),
      input.ip ? repository.countRecentChallengesForIp(input.ip) : { count: 0 },
      repository.latestChallengeForDestination(destination)
    ]);
    if (
      latest &&
      Date.now() - new Date(latest.created_at).getTime() <
        otpResendAfterSeconds * 1000
    )
      return responseError(
        429,
        "OTP_RESEND_COOLDOWN",
        "Please wait before requesting another OTP."
      );
    if (
      recentForDestination.count >= 5 ||
      recentForIp.count >= otpRateLimitPerIp
    )
      return responseError(
        429,
        "OTP_RATE_LIMITED",
        "Too many OTP requests. Try again later."
      );
    const existing = await repository.findUserByDestination(
      destination,
      channel
    );
    const challenge = await repository.createChallenge({
      userId: existing?.id || null,
      destination,
      channel,
      purpose,
      otpHash: hashWithPepper(`${destination}:${purpose}:${staticOtp}`),
      expiresAt: new Date(Date.now() + otpTtlSeconds * 1000),
      maxAttempts: otpMaxAttempts,
      ip: input.ip || null
    });
    return {
      ok: true,
      data: {
        challengeId: challenge.id,
        destinationMasked: maskDestination({ destination, channel }),
        expiresInSeconds: otpTtlSeconds,
        resendAfterSeconds: otpResendAfterSeconds
      }
    };
  }

  static async verifyOtp(input) {
    if (!input.challengeId || !input.otp)
      return responseError(
        400,
        "INVALID_OTP",
        "challengeId and otp are required."
      );
    const challenge = await repository.challengeById(input.challengeId);
    if (!challenge)
      return responseError(410, "OTP_EXPIRED", "OTP has expired.");
    const { destination, channel, purpose } = challenge;
    if (
      !challenge ||
      challenge.verified_at ||
      new Date(challenge.expires_at) <= new Date()
    )
      return responseError(410, "OTP_EXPIRED", "OTP has expired.");
    if (challenge.attempt_count >= challenge.max_attempts)
      return responseError(429, "OTP_MAX_ATTEMPTS", "Too many OTP attempts.");
    const expected = hashWithPepper(
      `${destination}:${purpose}:${String(input.otp)}`
    );
    if (!safeEqualHex(challenge.otp_hash, expected)) {
      const failed = await repository.recordFailedAttempt(challenge.id);
      return !failed || failed.attempt_count >= failed.max_attempts
        ? responseError(429, "OTP_MAX_ATTEMPTS", "Too many OTP attempts.")
        : responseError(401, "INVALID_OTP", "Invalid OTP.");
    }
    const verified = await repository.consumeChallenge(challenge.id, expected);
    if (!verified)
      return responseError(
        410,
        "OTP_UNAVAILABLE",
        "OTP has expired or was already used."
      );
    let userId = verified.user_id;
    if (!userId) {
      userId = (
        await repository.createUser({
          destination,
          channel,
          name: displayName({ destination })
        })
      )?.id;
      if (!userId) {
        const existing = await repository.findUserByDestination(
          destination,
          channel
        );
        if (!existing)
          return responseError(
            409,
            "ACCOUNT_CREATION_RETRY",
            "Account creation is in progress. Please retry verification."
          );
        userId = existing.id;
      }
      // A verified individual can browse and create their own listing from the
      // first session. Business-specific roles are added explicitly later.
      await repository.addDefaultRoles(userId);
    }
    return this.createSession({
      userId,
      ip: input.ip,
      userAgent: input.userAgent,
      deviceId: input.deviceId,
      deviceName: input.deviceName
    });
  }

  static async createSession({
    userId,
    ip = null,
    userAgent = null,
    deviceId = null,
    deviceName = null
  }) {
    const user = await repository.findActiveUser(userId);
    if (!user || user.status !== "ACTIVE")
      return responseError(
        401,
        "ACCOUNT_UNAVAILABLE",
        "Account is unavailable."
      );
    const refreshToken = randomToken(48);
    const session = await repository.createRefreshSession({
      userId,
      tokenHash: hashWithPepper(`refresh:${refreshToken}`),
      ip,
      userAgent,
      deviceId,
      deviceName,
      expiresAt: new Date(Date.now() + refreshTtlDays * 86400000)
    });
    const roles = await rolesFor(userId);
    await repository.updateLastLogin(userId);
    return {
      ok: true,
      data: {
        accessToken: signAccessToken({ userId, sessionId: session.id, roles }),
        refreshToken,
        accessTokenExpiresIn: accessTtlSeconds,
        refreshTokenExpiresIn: refreshTtlDays * 86400,
        user: userSummary(user, roles)
      }
    };
  }

  static async refresh({ refreshToken, ip, userAgent, deviceId, deviceName }) {
    if (!refreshToken)
      return responseError(
        401,
        "INVALID_REFRESH_TOKEN",
        "Invalid refresh token."
      );
    const session = await repository.findRefreshSession(
      hashWithPepper(`refresh:${refreshToken}`)
    );
    if (!session)
      return responseError(
        401,
        "INVALID_REFRESH_TOKEN",
        "Invalid refresh token."
      );
    await repository.revokeSession(session.id);
    return this.createSession({
      userId: session.user_id,
      ip,
      userAgent,
      deviceId,
      deviceName
    });
  }

  static async authenticate(accessToken, { requireAdmin = false } = {}) {
    try {
      const claims = jwt.verify(accessToken, jwtSecret, {
        issuer: "zameens-api",
        audience: "zameens-app"
      });
      const session = await repository.authenticatedSession({
        sessionId: claims.sid,
        userId: claims.sub
      });
      if (!session || session.status !== "ACTIVE") return null;
      const roles = await rolesFor(session.userId);
      if (requireAdmin && !roles.includes("ADMIN")) return null;
      return {
        id: session.userId,
        name: session.displayName,
        phone: session.phoneE164,
        email: session.email,
        preferredLanguage: session.preferredLanguage,
        roles,
        sessionId: session.sessionId
      };
    } catch {
      return null;
    }
  }

  static logout = sessionId => repository.revokeSession(sessionId);
  static logoutAll = userId => repository.revokeUserSessions(userId);
}

export default AuthService;

import AuthService from "../api/auth/auth.service.js";

const makeAuthMiddleware = ({ scope, userKey, tokenKey, sessionKey }) => {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;

      if (!token) {
        return res.status(401).json({ status: 401, message: "UNAUTHORIZED" });
      }

      const me = await AuthService.me({ scope, token });

      if (!me || me.status !== 200) {
        return res
          .status(me?.status || 401)
          .json(me || { status: 401, message: "UNAUTHORIZED" });
      }

      req[tokenKey] = token;
      req[userKey] = me.data?.user || null;
      req[sessionKey] = me.data?.session || null;

      return next();
    } catch (e) {
      return next(e);
    }
  };
};

export const adminAuthenticateToken = makeAuthMiddleware({
  scope: "admin",
  userKey: "admin_user",
  tokenKey: "admin_token",
  sessionKey: "admin_session"
});

export const userAuthenticateToken = makeAuthMiddleware({
  scope: "user",
  userKey: "user",
  tokenKey: "user_token",
  sessionKey: "user_session"
});

export default makeAuthMiddleware;

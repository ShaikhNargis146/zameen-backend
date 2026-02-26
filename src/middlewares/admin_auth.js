import AdminAuthService from "../api/adminAuth/adminAuth.service.js";

const adminAuthenticateToken = async (req, res, next) => {
  try {
    console.log("[admin_auth middleware]", req.method, req.originalUrl);

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ status: 401, message: "UNAUTHORIZED" });
    }

    const me = await AdminAuthService.me({ token });

    // SUCCESS = status 200
    if (me.status !== 200) {
      return res.status(me.status || 401).json(me);
    }

    req.admin_token = token;
    req.admin_user = me.data?.user || null;
    req.admin_session = me.data?.session || null;

    return next();
  } catch (e) {
    return next(e);
  }
};

export default adminAuthenticateToken;

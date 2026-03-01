import UserAuthService from "../api/userAuth/userAuth.service.js";

const userAuthenticateToken = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ status: 401, message: "UNAUTHORIZED" });
    }

    const me = await UserAuthService.me({ token });

    if (!me || me.status !== 200) {
      return res
        .status(me?.status || 401)
        .json(me || { status: 401, message: "UNAUTHORIZED" });
    }

    req.user_token = token;
    req.user = me.data?.user || null;
    req.user_session = me.data?.session || null;

    return next();
  } catch (e) {
    next(e);
  }
};

export default userAuthenticateToken;

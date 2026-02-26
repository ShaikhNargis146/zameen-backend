import AuthService from "./auth.service.js";

const AuthController = {
  requestOtp: async (req, res) => {
    const { phone } = req.body || {};
    const r = await AuthService.requestOtp({ phone });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "OTP sent (POC)", data: r.data });
  },

  login: async (req, res) => {
    const { phone, otp, role } = req.body || {};
    // role is optional; if provided, we can enforce admin-only login etc. (optional)
    const r = await AuthService.login({ phone, otp, role });
    if (!r.ok)
      return res
        .status(401)
        .json({ message: r.error?.message || "Invalid credentials" });
    return res.json({ message: "OK", data: r.data });
  },

  me: async (req, res) => {
    const r = await AuthService.me({ user: req.user });
    if (!r.ok)
      return res.status(400).json({ message: r.error?.message || "Failed" });
    return res.json({ message: "OK", data: r.data });
  }
};

export default AuthController;

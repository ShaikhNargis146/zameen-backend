import AuthService from "../auth/auth.service.js";

class AdminAuthService {
  static requestOtp = args =>
    AuthService.requestOtp({ scope: "admin", ...args });
  static verifyOtp = args => AuthService.verifyOtp({ scope: "admin", ...args });
  static me = args => AuthService.me({ scope: "admin", ...args });
  static logout = args => AuthService.logout({ scope: "admin", ...args });
}

export default AdminAuthService;

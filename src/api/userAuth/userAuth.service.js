import AuthService from "../auth/auth.service.js";

class UserAuthService {
  static requestOtp = args =>
    AuthService.requestOtp({ scope: "user", ...args });

  static verifyOtp = args => AuthService.verifyOtp({ scope: "user", ...args });

  static me = args => AuthService.me({ scope: "user", ...args });

  static updateProfile = args =>
    AuthService.updateProfile({ scope: "user", ...args });

  static logout = args => AuthService.logout({ scope: "user", ...args });
}

export default UserAuthService;

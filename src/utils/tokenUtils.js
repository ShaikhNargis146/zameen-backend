import jwt from "jsonwebtoken";
const SECRET_KEY = process.env.JWT_SECRET || "your-secret-key";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "your-refresh-secret";

// Generate Access Token (Short-lived)
const generateAccessToken = user => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    SECRET_KEY,
    { expiresIn: "10h" }
  );
};

// Generate Refresh Token (Long-lived)
const generateRefreshToken = user => {
  return jwt.sign(
    { id: user.id },
    REFRESH_SECRET,
    { expiresIn: "30d" } // 7-day expiry
  );
};

const verifyRefreshToken = refreshToken => {
  jwt.verify(refreshToken, REFRESH_SECRET, (err, decoded) => {
    if (err) return { message: "Invalid refresh token" };

    // Generate a new access token
    const newAccessToken = generateAccessToken(decoded);
    return { accessToken: newAccessToken };
  });
};

export default {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken
};

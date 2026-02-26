import crypto from "crypto";

const PEPPER = process.env.TOKEN_PEPPER || "dev-pepper-change-me";

export const sha256 = input =>
  crypto
    .createHash("sha256")
    .update(String(input))
    .digest("hex");

export const hashWithPepper = input => sha256(`${input}:${PEPPER}`);

export const randomToken = (bytes = 32) =>
  crypto.randomBytes(bytes).toString("hex");

export const safeEqualHex = (a, b) => {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
};

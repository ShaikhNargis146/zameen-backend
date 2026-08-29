import dotenvSafe from "dotenv-safe";
import path from "node:path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adjust paths if your .env is elsewhere
dotenvSafe.config({
  example: path.join(__dirname, "../../.env.example"),
  path: path.join(__dirname, "../../.env")
});

// Only these two environments get relaxed defaults (dev secret fallbacks,
// console OTP delivery, verbose error messages). Anything else - unset, a
// typo, "staging" - is treated as production-strict rather than silently
// falling back to insecure behavior.
export const isNonProductionEnv = ["development", "test"].includes(
  String(process.env.NODE_ENV || "").toLowerCase()
);

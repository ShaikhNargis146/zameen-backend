import dotenvSafe from "dotenv-safe";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adjust paths if your .env is elsewhere
dotenvSafe.config({
  example: path.join(__dirname, "../../.env.example"),
  path: path.join(__dirname, "../../.env")
});

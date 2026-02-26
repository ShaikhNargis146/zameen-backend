import { createLogger, format, transports } from "winston";
import path from "path";
import { fileURLToPath } from "url";
import "winston-daily-rotate-file";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  trace: "white",
  debug: "blue",
  info: "green",
  warn: "yellow",
  crit: "red",
  fatal: "red"
};

const logger = createLogger({
  level: "debug",
  format: format.combine(
    format.label({ label: path.basename(__dirname) }),
    format.colorize({ colors }),
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.printf(
      info => `${info.timestamp} ${info.level} [${info.label}]: ${info.message}`
    )
  ),
  transports: [
    new transports.Console(),
    new transports.DailyRotateFile({
      filename: "logs/server/%DATE%/combined.log",
      datePattern: "DD-MMM-YYYY",
      level: "debug",
      format: format.combine(format.uncolorize())
    }),
    new transports.DailyRotateFile({
      filename: "logs/server/%DATE%/errors.log",
      datePattern: "DD-MMM-YYYY",
      level: "error",
      format: format.combine(format.uncolorize())
    })
  ]
});

export default logger;

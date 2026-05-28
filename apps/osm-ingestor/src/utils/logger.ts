import pino from "pino";
import packageJson from "../../package.json" with { type: "json" };
import { logLevel } from "../config.ts";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: logLevel,
  base: {
    app: "osm-ingestor",
    version: packageJson.version,
    env: process.env.NODE_ENV ?? "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.accessToken",
      "*.authorization",
      "req.headers.authorization",
    ],
    censor: "[REDACTED]",
    remove: false,
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname,app,env,version",
            singleLine: false,
          },
        },
      }),
});

import { pino } from "pino";
import { env } from "./config.ts";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "osm-ingestor" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.accessToken",
      "*.authorization",
      "req.headers.authorization",
    ],
    censor: "[REDACTED]",
  },
  ...(env.NODE_ENV === "production"
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname,app",
          },
        },
      }),
});

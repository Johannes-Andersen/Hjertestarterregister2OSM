import { pino } from "pino";
import { env } from "./config.ts";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "aed-reconciler", dry: env.DRY },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: {
    paths: ["*.token", "*.accessToken", "*.authorization", "OSM_AUTH_TOKEN"],
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

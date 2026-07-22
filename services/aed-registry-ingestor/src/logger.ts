import { pino } from "pino";
import { env } from "./config.ts";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "aed-registry-ingestor" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: {
    paths: [
      "*.password",
      "*.clientSecret",
      "*.client_secret",
      "*.token",
      "*.accessToken",
      "*.authorization",
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

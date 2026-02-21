import pino from "pino";
import { logLevel } from "../config.ts";

export const logger = pino({
  level: logLevel,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

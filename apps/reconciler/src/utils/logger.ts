import pino from "pino";
import { logLevel, reconcilerConfig } from "../config.ts";

const isDryRun = reconcilerConfig.mode === "dry-run";

export const logger = pino({
  level: logLevel,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

export const reconciliationLogger = logger.child(
  { module: "reconciler" },
  {
    msgPrefix: isDryRun ? "[DRY-RUN] " : "",
  },
);

import { closeDatabase, migrateDatabase } from "./db/index.ts";
import { closeEventsQueue } from "./events.ts";
import { logger } from "./logger.ts";
import { redis } from "./redis.ts";
import { startScheduler, stopScheduler } from "./scheduler.ts";

const log = logger.child({ module: "bootstrap" });

const main = async (): Promise<void> => {
  log.info(
    { pid: process.pid, node: process.version },
    "Starting AED registry ingestor",
  );
  await migrateDatabase();
  await startScheduler();
  log.info("AED registry ingestor ready");
};

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "Starting graceful shutdown");

  await stopScheduler();
  await closeEventsQueue();
  await redis.quit();
  await closeDatabase();

  log.info("Graceful shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
process.on("uncaughtException", (err) => {
  log.fatal({ err }, "Uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  log.fatal({ err }, "Unhandled promise rejection");
  process.exit(1);
});

main().catch((err) => {
  log.fatal({ err }, "Failed to start AED registry ingestor");
  process.exit(1);
});

import { setupSyncOsmQueue } from "./queues/syncOsmQueue.ts";
import { setupSyncOsmScheduler } from "./schedulers/syncOsmScheduler.ts";
import { logger } from "./utils/logger.ts";
import { setupSyncOsmWorker } from "./workers/syncOsmWorker.ts";

const log = logger.child({ module: "bootstrap" });

const setupQueues = async () => {
  log.debug("Setting up queues");
  await setupSyncOsmQueue();
  log.info("Queues ready");
};

const setupSchedulers = async () => {
  log.debug("Setting up schedulers");
  await setupSyncOsmScheduler();
  log.info("Schedulers ready");
};

const setupWorkers = async () => {
  log.debug("Setting up workers");
  await setupSyncOsmWorker();
  log.info("Workers ready");
};

const setup = async () => {
  log.info(
    { nodeVersion: process.version, pid: process.pid },
    "Starting OSM ingestor",
  );
  await setupQueues();
  await setupWorkers();
  await setupSchedulers();
  log.info("OSM ingestor setup complete");
};

process.on("uncaughtException", (err) => {
  log.fatal({ err }, "Uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.fatal({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});

setup().catch((err) => {
  log.fatal({ err }, "Failed to start OSM ingestor");
  process.exit(1);
});

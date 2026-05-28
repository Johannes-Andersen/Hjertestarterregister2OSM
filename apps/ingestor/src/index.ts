import { sql } from "./clients/postgresClient.ts";
import { redisConnection } from "./clients/redisClient.ts";
import {
  setupSyncRegistryQueue,
  syncRegistryQueue,
} from "./queues/syncRegistryQueue.ts";
import {
  setupUpdateAssetsQueue,
  updateAssetsQueue,
} from "./queues/updateAssetsQueue.ts";
import { setupSyncRegistryScheduler } from "./schedulers/syncRegistryScheduler.ts";
import { setupUpdateAssetsScheduler } from "./schedulers/updateAssetsScheduler.ts";
import { logger } from "./utils/logger.ts";
import { installShutdownHandlers } from "./utils/shutdown.ts";
import {
  setupSyncRegistryWorker,
  syncRegistryWorker,
} from "./workers/syncRegistryWorker.ts";
import {
  setupUpdateAssetsWorker,
  updateAssetsWorker,
} from "./workers/updateAssetsWorker.ts";

const log = logger.child({ module: "bootstrap" });

const setupQueues = async () => {
  log.debug("Setting up queues");
  await Promise.all([setupSyncRegistryQueue(), setupUpdateAssetsQueue()]);
  log.info("Queues ready");
};

const setupSchedulers = async () => {
  log.debug("Setting up schedulers");
  await Promise.all([
    setupSyncRegistryScheduler(),
    setupUpdateAssetsScheduler(),
  ]);
  log.info("Schedulers ready");
};

const setupWorkers = async () => {
  log.debug("Setting up workers");
  await Promise.all([setupSyncRegistryWorker(), setupUpdateAssetsWorker()]);
  log.info("Workers ready");
};

const setup = async () => {
  log.info(
    { nodeVersion: process.version, pid: process.pid },
    "Starting ingestor",
  );
  await setupQueues();
  await setupWorkers();
  await setupSchedulers();

  installShutdownHandlers({
    workers: [
      { worker: syncRegistryWorker, name: "sync-registry" },
      { worker: updateAssetsWorker, name: "update-assets" },
    ],
    queues: [
      { queue: syncRegistryQueue, name: "sync-registry" },
      { queue: updateAssetsQueue, name: "update-assets" },
    ],
    closeRedis: async () => {
      await redisConnection.quit();
    },
    closePostgres: async () => {
      await sql.end({ timeout: 5 });
    },
    log,
  });

  log.info("Ingestor setup complete");
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
  log.fatal({ err }, "Failed to start ingestor");
  process.exit(1);
});

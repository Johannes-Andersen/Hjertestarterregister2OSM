import { sql } from "./clients/postgresClient.ts";
import { redisConnection } from "./clients/redisClient.ts";
import { setupSyncOsmQueue, syncOsmQueue } from "./queues/syncOsmQueue.ts";
import { setupSyncOsmScheduler } from "./schedulers/syncOsmScheduler.ts";
import { logger } from "./utils/logger.ts";
import { installShutdownHandlers } from "./utils/shutdown.ts";
import { setupSyncOsmWorker, syncOsmWorker } from "./workers/syncOsmWorker.ts";

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

  installShutdownHandlers({
    workers: [{ worker: syncOsmWorker, name: "sync-osm" }],
    queues: [{ queue: syncOsmQueue, name: "sync-osm" }],
    closeRedis: async () => {
      await redisConnection.quit();
    },
    closePostgres: async () => {
      await sql.end({ timeout: 5 });
    },
    log,
  });

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

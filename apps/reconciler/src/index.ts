import { sql } from "./clients/postgresClient.ts";
import { redisConnection } from "./clients/redisClient.ts";
import {
  reconcileChangedAedQueue,
  setupReconcileChangedAedQueue,
} from "./queues/reconcileChangedAedQueue.ts";
import {
  reconcileScheduledQueue,
  setupReconcileScheduledQueue,
} from "./queues/reconcileScheduledQueue.ts";
import { setupReconcileScheduledScheduler } from "./schedulers/reconcileScheduledScheduler.ts";
import { logger } from "./utils/logger.ts";
import { installShutdownHandlers } from "./utils/shutdown.ts";
import {
  reconcileChangedAedWorker,
  setupReconcileChangedAedWorker,
} from "./workers/reconcileChangedAedWorker.ts";
import {
  reconcileScheduledWorker,
  setupReconcileScheduledWorker,
} from "./workers/reconcileScheduledWorker.ts";

const log = logger.child({ module: "bootstrap" });

const setupQueues = async () => {
  log.debug("Setting up queues");
  await Promise.all([
    setupReconcileScheduledQueue(),
    setupReconcileChangedAedQueue(),
  ]);
  log.info("Queues ready");
};

const setupSchedulers = async () => {
  log.debug("Setting up schedulers");
  await setupReconcileScheduledScheduler();
  log.info("Schedulers ready");
};

const setupWorkers = async () => {
  log.debug("Setting up workers");
  await Promise.all([
    setupReconcileScheduledWorker(),
    setupReconcileChangedAedWorker(),
  ]);
  log.info("Workers ready");
};

const setup = async () => {
  log.info(
    { nodeVersion: process.version, pid: process.pid },
    "Starting reconciler",
  );
  await setupQueues();
  await setupWorkers();
  await setupSchedulers();

  installShutdownHandlers({
    workers: [
      { worker: reconcileScheduledWorker, name: "reconcile-scheduled" },
      { worker: reconcileChangedAedWorker, name: "reconcile-changed-aed" },
    ],
    queues: [
      { queue: reconcileScheduledQueue, name: "reconcile-scheduled" },
      { queue: reconcileChangedAedQueue, name: "reconcile-changed-aed" },
    ],
    closeRedis: async () => {
      await redisConnection.quit();
    },
    closePostgres: async () => {
      await sql.end({ timeout: 5 });
    },
    log,
  });

  log.info("Reconciler setup complete");
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
  log.fatal({ err }, "Failed to start reconciler");
  process.exit(1);
});

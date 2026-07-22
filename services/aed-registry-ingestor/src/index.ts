import { closeDatabase } from "./clients/postgresClient.ts";
import { redisConnection } from "./clients/redisClient.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { aedEventQueue, setupAedEventQueue } from "./queues/aedEventQueue.ts";
import { registrySyncScheduler } from "./schedulers/registrySyncScheduler.ts";
import { logger } from "./utils/logger.ts";
import { installShutdownHandlers } from "./utils/shutdown.ts";

const log = logger.child({ module: "bootstrap" });

const setup = async () => {
  log.info(
    { nodeVersion: process.version, pid: process.pid },
    "Starting AED registry ingestor",
  );

  await migrateDatabase();
  await setupAedEventQueue();

  installShutdownHandlers({
    stopScheduling: () => registrySyncScheduler.stop(),
    eventQueue: aedEventQueue,
    closeRedis: async () => {
      await redisConnection.quit();
    },
    closePostgres: async () => {
      await closeDatabase();
    },
    log,
  });

  await registrySyncScheduler.start();

  log.info("AED registry ingestor ready");
};

process.on("uncaughtException", (error) => {
  log.fatal({ err: error }, "Uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.fatal({ err: reason }, "Unhandled promise rejection");
  process.exit(1);
});

setup().catch((error) => {
  log.fatal({ err: error }, "Failed to start AED registry ingestor");
  process.exit(1);
});

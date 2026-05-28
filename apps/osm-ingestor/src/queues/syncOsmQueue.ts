import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { queueRateLimits } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "queue", queue: "sync-osm" });

export const syncOsmQueue = new Queue("sync-osm", {
  connection: redisConnection,
});

export const setupSyncOsmQueue = async () => {
  log.debug("Setting up queue");
  await syncOsmQueue.waitUntilReady();
  await syncOsmQueue.setGlobalConcurrency(1);
  await syncOsmQueue.setGlobalRateLimit(
    queueRateLimits.syncOsm.max,
    queueRateLimits.syncOsm.duration,
  );
  log.info(
    { rateLimit: queueRateLimits.syncOsm, concurrency: 1 },
    "Queue ready",
  );
};

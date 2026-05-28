import { Queue } from "bullmq";
import { queueRateLimits } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "queue", queue: "sync-registry" });

export const syncRegistryQueue = new Queue("sync-registry");

export const setupSyncRegistryQueue = async () => {
  log.debug("Setting up queue");
  await syncRegistryQueue.waitUntilReady();
  await syncRegistryQueue.setGlobalConcurrency(1);
  await syncRegistryQueue.setGlobalRateLimit(
    queueRateLimits.syncRegistry.max,
    queueRateLimits.syncRegistry.duration,
  );
  log.info({ rateLimit: queueRateLimits.syncRegistry }, "Queue ready");
};

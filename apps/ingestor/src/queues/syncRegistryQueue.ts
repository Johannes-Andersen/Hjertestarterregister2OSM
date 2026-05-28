import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { jobPolicies, queueRateLimits } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "queue", queue: "sync-registry" });

const policy = jobPolicies.syncRegistry;
const rateLimit = queueRateLimits.syncRegistry;

export const syncRegistryQueue = new Queue("sync-registry", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
  },
});

export const setupSyncRegistryQueue = async () => {
  log.debug("Setting up queue");
  await syncRegistryQueue.waitUntilReady();
  await syncRegistryQueue.setGlobalConcurrency(1);
  await syncRegistryQueue.setGlobalRateLimit(rateLimit.max, rateLimit.duration);
  log.info({ rateLimit, policy }, "Queue ready");
};

import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { jobPolicies, queueRateLimits } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "queue", queue: "sync-osm" });

const policy = jobPolicies.syncOsm;
const rateLimit = queueRateLimits.syncOsm;

export const syncOsmQueue = new Queue("sync-osm", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
  },
});

export const setupSyncOsmQueue = async () => {
  log.debug("Setting up queue");
  await syncOsmQueue.waitUntilReady();
  await syncOsmQueue.setGlobalConcurrency(1);
  await syncOsmQueue.setGlobalRateLimit(rateLimit.max, rateLimit.duration);
  log.info({ rateLimit, policy }, "Queue ready");
};

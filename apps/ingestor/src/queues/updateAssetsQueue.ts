import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { jobPolicies, queueRateLimits } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "queue", queue: "update-assets" });

const policy = jobPolicies.updateAssets;
const rateLimit = queueRateLimits.updateAssets;

export const updateAssetsQueue = new Queue("update-assets", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
  },
});

export const setupUpdateAssetsQueue = async () => {
  log.debug("Setting up queue");
  await updateAssetsQueue.waitUntilReady();
  await updateAssetsQueue.setGlobalConcurrency(1);
  await updateAssetsQueue.setGlobalRateLimit(rateLimit.max, rateLimit.duration);
  log.info({ rateLimit, policy }, "Queue ready");
};

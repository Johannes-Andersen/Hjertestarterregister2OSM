import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { jobPolicies, queueRateLimits } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "queue", queue: "reconcile-scheduled" });

const policy = jobPolicies.reconcileScheduled;
const rateLimit = queueRateLimits.reconcileScheduled;

export const reconcileScheduledQueue = new Queue("reconcile-scheduled", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
  },
});

export const setupReconcileScheduledQueue = async () => {
  log.debug("Setting up queue");
  await reconcileScheduledQueue.waitUntilReady();
  await reconcileScheduledQueue.setGlobalConcurrency(1);
  await reconcileScheduledQueue.setGlobalRateLimit(
    rateLimit.max,
    rateLimit.duration,
  );
  log.info({ rateLimit, policy }, "Queue ready");
};

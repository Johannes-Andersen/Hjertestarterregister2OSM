import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { jobPolicies, queueRateLimits } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "queue", queue: "reconcile-changed-aed" });

const policy = jobPolicies.reconcileChangedAed;
const rateLimit = queueRateLimits.reconcileChangedAed;

export const reconcileChangedAedQueue = new Queue("reconcile-changed-aed", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
  },
});

export const setupReconcileChangedAedQueue = async () => {
  log.debug("Setting up queue");
  await reconcileChangedAedQueue.waitUntilReady();
  await reconcileChangedAedQueue.setGlobalConcurrency(1);
  await reconcileChangedAedQueue.setGlobalRateLimit(
    rateLimit.max,
    rateLimit.duration,
  );
  log.info({ rateLimit, policy }, "Queue ready");
};

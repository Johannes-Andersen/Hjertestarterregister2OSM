import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({
  module: "queue",
  queue: "reconcile-changed-aed",
});

export const reconcileChangedAedQueue = new Queue("reconcile-changed-aed", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30_000 },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 200 },
    removeOnFail: { age: 30 * 24 * 60 * 60, count: 500 },
  },
});

export const setupReconcileChangedAedQueue = async () => {
  log.debug("Setting up queue");
  await reconcileChangedAedQueue.waitUntilReady();
  log.info("Queue ready");
};

import { jobPolicies, schedulerPatterns, timezone } from "../config.ts";
import { reconcileScheduledQueue } from "../queues/reconcileScheduledQueue.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({
  module: "scheduler",
  scheduler: "reconcile-scheduled",
});

const policy = jobPolicies.reconcileScheduled;

const config = {
  pattern: schedulerPatterns.reconcileScheduled,
  tz: timezone,
  immediately: false,
};

const template = {
  name: "reconcile-scheduled",
  opts: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
    deduplication: { id: policy.deduplicationId },
  },
};

export const setupReconcileScheduledScheduler = async () => {
  log.debug("Setting up scheduler");
  await reconcileScheduledQueue.upsertJobScheduler(
    "reconcile-scheduled-scheduler",
    config,
    template,
  );
  log.info({ config, template }, "Scheduler ready");
};

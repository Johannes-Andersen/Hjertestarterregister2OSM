import { jobPolicies, schedulerPatterns, timezone } from "../config.ts";
import { syncRegistryQueue } from "../queues/syncRegistryQueue.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({
  module: "scheduler",
  scheduler: "sync-registry",
});

const policy = jobPolicies.syncRegistry;

const config = {
  pattern: schedulerPatterns.syncRegistry,
  tz: timezone,
  immediately: true,
};

const template = {
  name: "sync-registry",
  opts: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
    deduplication: { id: policy.deduplicationId },
  },
};

export const setupSyncRegistryScheduler = async () => {
  log.debug("Setting up scheduler");
  await syncRegistryQueue.upsertJobScheduler(
    "sync-registry-scheduler",
    config,
    template,
  );
  log.info({ config, template }, "Scheduler ready");
};

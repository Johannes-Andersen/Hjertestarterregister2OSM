import { jobPolicies, schedulerPatterns, timezone } from "../config.ts";
import { syncOsmQueue } from "../queues/syncOsmQueue.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "scheduler", scheduler: "sync-osm" });

const policy = jobPolicies.syncOsm;

const config = {
  pattern: schedulerPatterns.syncOsm,
  tz: timezone,
  immediately: true,
};

const template = {
  name: "sync-osm",
  opts: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
    deduplication: { id: policy.deduplicationId },
  },
};

export const setupSyncOsmScheduler = async () => {
  log.debug("Setting up scheduler");
  await syncOsmQueue.upsertJobScheduler("sync-osm-scheduler", config, template);
  log.info({ config, template }, "Scheduler ready");
};

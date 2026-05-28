import { schedulerPatterns, timezone } from "../config.ts";
import { syncRegistryQueue } from "../queues/syncRegistryQueue.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({
  module: "scheduler",
  scheduler: "sync-registry",
});

const config = {
  pattern: schedulerPatterns.syncRegistry,
  tz: timezone,
  immediately: true,
};

export const setupSyncRegistryScheduler = async () => {
  log.debug("Setting up scheduler");
  await syncRegistryQueue.upsertJobScheduler("sync-registry-scheduler", config);
  log.info({ config }, "Scheduler ready");
};

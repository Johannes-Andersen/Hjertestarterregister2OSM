import { schedulerPatterns, timezone } from "../config.ts";
import { syncOsmQueue } from "../queues/syncOsmQueue.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "scheduler", scheduler: "sync-osm" });

export const setupSyncOsmScheduler = async () => {
  log.debug("Setting up scheduler");
  await syncOsmQueue.upsertJobScheduler("sync-osm-scheduler", {
    pattern: schedulerPatterns.syncOsm,
    tz: timezone,
    immediately: true,
  });
  log.info(
    { pattern: schedulerPatterns.syncOsm, tz: timezone, immediately: true },
    "Scheduler ready",
  );
};

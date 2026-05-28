import { schedulerPatterns, timezone } from "../config.ts";
import { syncOsmQueue } from "../queues/syncOsmQueue.ts";

export const setupSyncOsmScheduler = async () => {
  console.log("Setting up syncOsmScheduler...");
  await syncOsmQueue.upsertJobScheduler("sync-osm-scheduler", {
    pattern: schedulerPatterns.syncOsm,
    tz: timezone,
    immediately: true,
  });
  console.log("syncOsmScheduler is set up and ready.");
};

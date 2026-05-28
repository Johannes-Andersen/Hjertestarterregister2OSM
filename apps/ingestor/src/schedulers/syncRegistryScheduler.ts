import { schedulerPatterns, timezone } from "../config.ts";
import { syncRegistryQueue } from "../queues/syncRegistryQueue.ts";

export const setupSyncRegistryScheduler = async () => {
  console.log("Setting up syncRegistryScheduler...");
  await syncRegistryQueue.upsertJobScheduler("sync-registry-scheduler", {
    pattern: schedulerPatterns.syncRegistry,
    tz: timezone,
    immediately: true,
  });
  console.log("syncRegistryScheduler is set up and ready.");
};

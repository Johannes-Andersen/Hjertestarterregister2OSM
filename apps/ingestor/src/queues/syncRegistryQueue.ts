import { Queue } from "bullmq";
import { queueRateLimits } from "../config.ts";

export const syncRegistryQueue = new Queue("sync-registry");

export const setupSyncRegistryQueue = async () => {
  console.log("Setting up syncRegistryQueue...");
  await syncRegistryQueue.waitUntilReady();
  await syncRegistryQueue.setGlobalConcurrency(1);
  await syncRegistryQueue.setGlobalRateLimit(
    queueRateLimits.syncRegistry.max,
    queueRateLimits.syncRegistry.duration,
  );
  console.log("syncRegistryQueue is set up and ready.");
};

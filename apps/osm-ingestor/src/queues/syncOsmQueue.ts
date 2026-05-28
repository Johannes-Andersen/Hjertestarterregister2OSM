import { Queue } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { queueRateLimits } from "../config.ts";

export const syncOsmQueue = new Queue("sync-osm", {
  connection: redisConnection,
});

export const setupSyncOsmQueue = async () => {
  console.log("Setting up syncOsmQueue...");
  await syncOsmQueue.waitUntilReady();
  await syncOsmQueue.setGlobalConcurrency(1);
  await syncOsmQueue.setGlobalRateLimit(
    queueRateLimits.syncOsm.max,
    queueRateLimits.syncOsm.duration,
  );
  console.log("syncOsmQueue is set up and ready.");
};

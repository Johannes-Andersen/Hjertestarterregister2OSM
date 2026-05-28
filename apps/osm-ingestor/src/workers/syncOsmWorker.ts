import { Worker } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { syncOsmJobProcessor } from "../processors/syncOsmJobProcessor.ts";

export const syncOsmWorker = new Worker(
  "sync-osm",
  async (job) => await syncOsmJobProcessor(job),
  {
    connection: redisConnection,
  },
);

syncOsmWorker.on("failed", (job, error) => {
  console.error("syncOsmWorker job failed:", job?.id, error);
});

syncOsmWorker.on("error", (error) => {
  console.error("syncOsmWorker error:", error);
});

export const setupSyncOsmWorker = async () => {
  console.log("Setting up syncOsmWorker...");
  await syncOsmWorker.waitUntilReady();
  console.log("syncOsmWorker is set up and ready.");
};

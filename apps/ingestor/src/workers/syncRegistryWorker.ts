import { Worker } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { syncRegistryJobProcessor } from "../processors/syncRegistryJobProcessor.ts";

export const syncRegistryWorker = new Worker(
  "sync-registry",
  async (job) => await syncRegistryJobProcessor(job),
  {
    connection: redisConnection,
  },
);

syncRegistryWorker.on("failed", (job, error) => {
  console.error("syncRegistryWorker job failed:", job?.id, error);
});

syncRegistryWorker.on("error", (error) => {
  console.error("syncRegistryWorker error:", error);
});

export const setupSyncRegistryWorker = async () => {
  console.log("Setting up syncRegistryWorker...");
  await syncRegistryWorker.waitUntilReady();
  console.log("syncRegistryWorker is set up and ready.");
};

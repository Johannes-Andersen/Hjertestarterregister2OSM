import { Worker } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { updateAssetsJobProcessor } from "../processors/updateAssetsJobProcessor.ts";

export const updateAssetsWorker = new Worker(
  "update-assets",
  async (job) => await updateAssetsJobProcessor(job),

  {
    connection: redisConnection,
  },
);

updateAssetsWorker.on("failed", (job, error) => {
  console.error("updateAssetsWorker job failed:", job?.id, error);
});

updateAssetsWorker.on("error", (error) => {
  console.error("updateAssetsWorker error:", error);
});

export const setupUpdateAssetsWorker = async () => {
  console.log("Setting up updateAssetsWorker...");
  await updateAssetsWorker.waitUntilReady();
  console.log("updateAssetsWorker is set up and ready.");
};

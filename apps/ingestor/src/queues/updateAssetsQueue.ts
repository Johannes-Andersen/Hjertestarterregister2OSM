import { Queue } from "bullmq";
import { queueRateLimits } from "../config.ts";

export const updateAssetsQueue = new Queue("update-assets");

export const setupUpdateAssetsQueue = async () => {
  console.log("Setting up updateAssetsQueue...");
  await updateAssetsQueue.waitUntilReady();
  await updateAssetsQueue.setGlobalConcurrency(1);
  await updateAssetsQueue.setGlobalRateLimit(
    queueRateLimits.updateAssets.max,
    queueRateLimits.updateAssets.duration,
  );
  console.log("updateAssetsQueue is set up and ready.");
};

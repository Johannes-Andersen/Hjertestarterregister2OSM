import { Queue } from "bullmq";
import { queueRateLimits } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "queue", queue: "update-assets" });

export const updateAssetsQueue = new Queue("update-assets");

export const setupUpdateAssetsQueue = async () => {
  log.debug("Setting up queue");
  await updateAssetsQueue.waitUntilReady();
  await updateAssetsQueue.setGlobalConcurrency(1);
  await updateAssetsQueue.setGlobalRateLimit(
    queueRateLimits.updateAssets.max,
    queueRateLimits.updateAssets.duration,
  );
  log.info({ rateLimit: queueRateLimits.updateAssets }, "Queue ready");
};

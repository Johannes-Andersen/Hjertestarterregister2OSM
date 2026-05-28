import { schedulerPatterns, timezone } from "../config.ts";
import { updateAssetsQueue } from "../queues/updateAssetsQueue.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({
  module: "scheduler",
  scheduler: "update-assets",
});

const config = {
  pattern: schedulerPatterns.updateAssets,
  tz: timezone,
  immediately: false,
};

export const setupUpdateAssetsScheduler = async () => {
  log.debug("Setting up scheduler");
  await updateAssetsQueue.upsertJobScheduler("update-assets-scheduler", config);
  log.info({ config }, "Scheduler ready");
};

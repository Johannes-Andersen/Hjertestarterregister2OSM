import { schedulerPatterns, timezone } from "../config.ts";
import { updateAssetsQueue } from "../queues/updateAssetsQueue.ts";

export const setupUpdateAssetsScheduler = async () => {
  console.log("Setting up updateAssetsScheduler...");
  await updateAssetsQueue.upsertJobScheduler("update-assets-scheduler", {
    pattern: schedulerPatterns.updateAssets,
    tz: timezone,
    immediately: false,
  });
  console.log("updateAssetsScheduler is set up and ready.");
};

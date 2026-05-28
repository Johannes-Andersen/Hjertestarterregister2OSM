import { jobPolicies, schedulerPatterns, timezone } from "../config.ts";
import { updateAssetsQueue } from "../queues/updateAssetsQueue.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({
  module: "scheduler",
  scheduler: "update-assets",
});

const policy = jobPolicies.updateAssets;

const config = {
  pattern: schedulerPatterns.updateAssets,
  tz: timezone,
  immediately: false,
};

const template = {
  name: "update-assets",
  opts: {
    attempts: policy.attempts,
    backoff: policy.backoff,
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
    deduplication: { id: policy.deduplicationId },
  },
};

export const setupUpdateAssetsScheduler = async () => {
  log.debug("Setting up scheduler");
  await updateAssetsQueue.upsertJobScheduler(
    "update-assets-scheduler",
    config,
    template,
  );
  log.info({ config, template }, "Scheduler ready");
};

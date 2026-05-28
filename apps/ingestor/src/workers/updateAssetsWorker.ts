import { Worker } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { updateAssetsJobProcessor } from "../processors/updateAssetsJobProcessor.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "worker", worker: "update-assets" });

export const updateAssetsWorker = new Worker(
  "update-assets",
  async (job) => {
    const jobLog = log.child({
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade + 1,
    });
    return await updateAssetsJobProcessor(job, jobLog);
  },
  {
    connection: redisConnection,
  },
);

updateAssetsWorker.on("active", (job) => {
  log.info({ jobId: job.id, jobName: job.name }, "Job started");
});

updateAssetsWorker.on("completed", (job, _result, prev) => {
  log.info(
    {
      jobId: job.id,
      jobName: job.name,
      durationMs:
        job.finishedOn && job.processedOn
          ? job.finishedOn - job.processedOn
          : null,
      previousStatus: prev,
    },
    "Job completed",
  );
});

updateAssetsWorker.on("failed", (job, err) => {
  log.error(
    {
      err,
      jobId: job?.id,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade,
      failedReason: job?.failedReason,
    },
    "Job failed",
  );
});

updateAssetsWorker.on("error", (err) => {
  log.error({ err }, "Worker error");
});

updateAssetsWorker.on("stalled", (jobId) => {
  log.warn({ jobId }, "Job stalled");
});

export const setupUpdateAssetsWorker = async () => {
  log.debug("Setting up worker");
  await updateAssetsWorker.waitUntilReady();
  log.info("Worker ready");
};

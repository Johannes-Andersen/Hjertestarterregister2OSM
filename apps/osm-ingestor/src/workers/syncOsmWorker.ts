import { Worker } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { syncOsmJobProcessor } from "../processors/syncOsmJobProcessor.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "worker", worker: "sync-osm" });

export const syncOsmWorker = new Worker(
  "sync-osm",
  async (job) => {
    const jobLog = log.child({
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade + 1,
    });
    return await syncOsmJobProcessor(job, jobLog);
  },
  {
    connection: redisConnection,
  },
);

syncOsmWorker.on("active", (job) => {
  log.info({ jobId: job.id, jobName: job.name }, "Job started");
});

syncOsmWorker.on("completed", (job, _result, prev) => {
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

syncOsmWorker.on("failed", (job, err) => {
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

syncOsmWorker.on("error", (err) => {
  log.error({ err }, "Worker error");
});

syncOsmWorker.on("stalled", (jobId) => {
  log.warn({ jobId }, "Job stalled");
});

export const setupSyncOsmWorker = async () => {
  log.debug("Setting up worker");
  await syncOsmWorker.waitUntilReady();
  log.info("Worker ready");
};

import { Worker } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { workerPolicies } from "../config.ts";
import { syncRegistryJobProcessor } from "../processors/syncRegistryJobProcessor.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "worker", worker: "sync-registry" });

const policy = workerPolicies.syncRegistry;

export const syncRegistryWorker = new Worker(
  "sync-registry",
  async (job, _token, signal) => {
    const jobLog = log.child({
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade + 1,
    });
    return await syncRegistryJobProcessor(job, jobLog, signal);
  },
  {
    connection: redisConnection,
    lockDuration: policy.lockDuration,
    stalledInterval: policy.stalledInterval,
    maxStalledCount: policy.maxStalledCount,
  },
);

syncRegistryWorker.on("lockRenewalFailed", (jobIds: string[]) => {
  log.warn({ jobIds }, "Lock renewal failed; cancelling jobs");
  for (const jobId of jobIds) {
    syncRegistryWorker.cancelJob(jobId, "Lock renewal failed");
  }
});

syncRegistryWorker.on("active", (job) => {
  log.info({ jobId: job.id, jobName: job.name }, "Job started");
});

syncRegistryWorker.on("completed", (job, _result, prev) => {
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

syncRegistryWorker.on("failed", (job, err) => {
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

syncRegistryWorker.on("error", (err) => {
  log.error({ err }, "Worker error");
});

syncRegistryWorker.on("stalled", (jobId) => {
  log.warn({ jobId }, "Job stalled");
});

export const setupSyncRegistryWorker = async () => {
  log.debug("Setting up worker");
  await syncRegistryWorker.waitUntilReady();
  log.info({ policy }, "Worker ready");
};

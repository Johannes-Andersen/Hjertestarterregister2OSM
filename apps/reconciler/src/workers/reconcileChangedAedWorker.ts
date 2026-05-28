import { Worker } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { workerPolicies } from "../config.ts";
import { reconcileChangedAedJobProcessor } from "../processors/reconcileChangedAedJobProcessor.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({
  module: "worker",
  worker: "reconcile-changed-aed",
});

const policy = workerPolicies.reconcileChangedAed;

export const reconcileChangedAedWorker = new Worker(
  "reconcile-changed-aed",
  async (job, _token, signal) => {
    const jobLog = log.child({
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade + 1,
    });
    return await reconcileChangedAedJobProcessor(job, jobLog, signal);
  },
  {
    connection: redisConnection,
    lockDuration: policy.lockDuration,
    stalledInterval: policy.stalledInterval,
    maxStalledCount: policy.maxStalledCount,
  },
);

reconcileChangedAedWorker.on("lockRenewalFailed", (jobIds: string[]) => {
  log.warn({ jobIds }, "Lock renewal failed; cancelling jobs");
  for (const jobId of jobIds) {
    reconcileChangedAedWorker.cancelJob(jobId, "Lock renewal failed");
  }
});

reconcileChangedAedWorker.on("active", (job) => {
  log.info({ jobId: job.id, jobName: job.name }, "Job started");
});

reconcileChangedAedWorker.on("completed", (job, _result, prev) => {
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

reconcileChangedAedWorker.on("failed", (job, err) => {
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

reconcileChangedAedWorker.on("error", (err) => {
  log.error({ err }, "Worker error");
});

reconcileChangedAedWorker.on("stalled", (jobId) => {
  log.warn({ jobId }, "Job stalled");
});

export const setupReconcileChangedAedWorker = async () => {
  log.debug("Setting up worker");
  await reconcileChangedAedWorker.waitUntilReady();
  log.info({ policy }, "Worker ready");
};

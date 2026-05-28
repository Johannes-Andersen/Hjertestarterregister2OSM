import { Worker } from "bullmq";
import { redisConnection } from "../clients/redisClient.ts";
import { workerPolicies } from "../config.ts";
import { reconcileScheduledJobProcessor } from "../processors/reconcileScheduledJobProcessor.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ module: "worker", worker: "reconcile-scheduled" });

const policy = workerPolicies.reconcileScheduled;

export const reconcileScheduledWorker = new Worker(
  "reconcile-scheduled",
  async (job, _token, signal) => {
    const jobLog = log.child({
      jobId: job.id,
      jobName: job.name,
      attempt: job.attemptsMade + 1,
    });
    return await reconcileScheduledJobProcessor(job, jobLog, signal);
  },
  {
    connection: redisConnection,
    lockDuration: policy.lockDuration,
    stalledInterval: policy.stalledInterval,
    maxStalledCount: policy.maxStalledCount,
  },
);

reconcileScheduledWorker.on("lockRenewalFailed", (jobIds: string[]) => {
  log.warn({ jobIds }, "Lock renewal failed; cancelling jobs");
  for (const jobId of jobIds) {
    reconcileScheduledWorker.cancelJob(jobId, "Lock renewal failed");
  }
});

reconcileScheduledWorker.on("active", (job) => {
  log.info({ jobId: job.id, jobName: job.name }, "Job started");
});

reconcileScheduledWorker.on("completed", (job, _result, prev) => {
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

reconcileScheduledWorker.on("failed", (job, err) => {
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

reconcileScheduledWorker.on("error", (err) => {
  log.error({ err }, "Worker error");
});

reconcileScheduledWorker.on("stalled", (jobId) => {
  log.warn({ jobId }, "Job stalled");
});

export const setupReconcileScheduledWorker = async () => {
  log.debug("Setting up worker");
  await reconcileScheduledWorker.waitUntilReady();
  log.info({ policy }, "Worker ready");
};

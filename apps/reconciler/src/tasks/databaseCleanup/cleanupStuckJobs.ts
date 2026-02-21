import type { Logger } from "pino";
import { syncStore } from "../../clients/syncStore.ts";

interface CleanupStuckJobsOptions {
  logger: Logger;
  stuckJobTimeoutMs: number;
}

export const cleanupStuckJobs = async ({
  logger,
  stuckJobTimeoutMs,
}: CleanupStuckJobsOptions) => {
  const log = logger.child({ task: "cleanupStuckJobs" });
  log.info("Starting cleanup of stuck jobs...");

  const jobs = await syncStore.listRunningRuns();
  log.debug(`Found ${jobs.length} running jobs`);

  for (const job of jobs) {
    const jobDuration = Date.now() - new Date(job.startedAt).getTime();

    log.trace(
      { job, jobDuration, stuckJobTimeoutMs },
      `Checking if job ${job.id} is stuck (duration: ${jobDuration} ms)`,
    );

    if (jobDuration > stuckJobTimeoutMs) {
      log.info(`Cleaning up stuck job ${job.id} (duration: ${jobDuration} ms)`);

      try {
        await syncStore.completeRun({
          runId: job.id,
          status: "failed",
          errorMessage: "Job marked as failed by cleanup task due to timeout",
        });

        log.info({ job }, `Successfully cleaned up job ${job.id}`);
      } catch (err) {
        log.error({ err, job }, `Failed to clean up job ${job.id}`);
      }
    }
  }

  log.info("Cleanup of stuck jobs finished");
};

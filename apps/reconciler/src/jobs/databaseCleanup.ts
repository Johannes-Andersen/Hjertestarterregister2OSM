import { syncStore } from "../clients/syncStore.ts";
import { databaseCleanupConfig } from "../config.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child({ task: "databaseCleanup" });

const cleanupStuckJobs = async () => {
  log.info("Starting cleanup of stuck jobs...");

  const jobs = await syncStore.listRunningRuns();
  log.debug(`Found ${jobs.length} running jobs.`);

  for (const job of jobs) {
    const jobDuration = Date.now() - new Date(job.startedAt).getTime();

    if (jobDuration > databaseCleanupConfig.stuckJobTimeoutMs) {
      log.info(`Cleaning up stuck job ${job.id} (duration: ${jobDuration} ms)`);

      try {
        await syncStore.completeRun({
          runId: job.id,
          status: "failed",
          errorMessage: "Job marked as failed by cleanup task due to timeout",
        });
        log.info(`Successfully cleaned up job ${job.id}`);
      } catch (error) {
        log.error(error, `Failed to clean up job ${job.id}:`);
      }
    }
  }

  log.info("Cleanup of stuck jobs finished.");
};

const cleanupOldJobs = async () => {
  log.info("Starting cleanup of old jobs...");

  const cutoffDate = new Date(
    Date.now() - databaseCleanupConfig.oldJobRetentionMs,
  );
  const oldJobs = await syncStore.listRunsCompletedBefore(cutoffDate);
  log.debug(
    `Found ${oldJobs.length} old jobs completed before ${cutoffDate.toISOString()}.`,
  );

  for (const job of oldJobs) {
    try {
      await syncStore.deleteRun(job.id);
      log.info(`Deleted old job ${job.id} finished at ${job.finishedAt}`);
    } catch (error) {
      log.error(error, `Failed to delete old job ${job.id}:`);
    }
  }

  log.info("Cleanup of old jobs finished.");
};

export const databaseCleanup = async () => {
  log.info("Starting database cleanup...");

  await cleanupStuckJobs();
  await cleanupOldJobs();

  log.info("Database cleanup finished.");
};

import type { Logger } from "pino";
import { syncStore } from "../../clients/syncStore.ts";

interface CleanupOldJobsOptions {
  logger: Logger;
  oldJobRetentionMs: number;
}

export const cleanupOldJobs = async ({
  logger,
  oldJobRetentionMs,
}: CleanupOldJobsOptions) => {
  const log = logger.child({ task: "cleanupOldJobs" });
  log.info("Starting cleanup of old jobs...");

  const cutoffDate = new Date(Date.now() - oldJobRetentionMs);
  const oldJobs = await syncStore.listRunsCompletedBefore(cutoffDate);

  log.debug(
    `Found ${oldJobs.length} older (cutoff: ${cutoffDate.toISOString()})`,
  );

  for (const job of oldJobs) {
    try {
      await syncStore.deleteRun(job.id);
      log.info({ job }, `Deleted old job ${job.id}`);
    } catch (err) {
      log.error({ err, job }, `Failed to delete old job ${job.id}`);
    }
  }

  log.info("Cleanup of old jobs finished");
};

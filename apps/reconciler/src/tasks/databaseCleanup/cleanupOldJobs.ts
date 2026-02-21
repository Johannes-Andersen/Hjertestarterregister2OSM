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
  const deletedCount = await syncStore.deleteRunsCompletedBefore(cutoffDate);

  log.info(
    `Deleted ${deletedCount} completed jobs older than cutoff (${cutoffDate.toISOString()})`,
  );

  log.info("Cleanup of old jobs finished");
};

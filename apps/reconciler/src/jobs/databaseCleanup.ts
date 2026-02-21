import { databaseCleanupConfig } from "../config.ts";
import { cleanupOldJobs } from "../tasks/databaseCleanup/cleanupOldJobs.ts";
import { cleanupStuckJobs } from "../tasks/databaseCleanup/cleanupStuckJobs.ts";
import { logger } from "../utils/logger.ts";

interface DatabaseCleanupOptions {
  runId: string;
}

export const databaseCleanup = async ({ runId }: DatabaseCleanupOptions) => {
  const log = logger.child({ job: "databaseCleanup", runId });

  log.info("Starting database cleanup...");

  await cleanupStuckJobs({
    logger: log,
    stuckJobTimeoutMs: databaseCleanupConfig.stuckJobTimeoutMs,
  });
  await cleanupOldJobs({
    logger: log,
    oldJobRetentionMs: databaseCleanupConfig.oldJobRetentionMs,
  });

  log.info("Database cleanup finished.");
};

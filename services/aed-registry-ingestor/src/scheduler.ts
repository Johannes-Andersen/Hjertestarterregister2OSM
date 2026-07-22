import { Queue, Worker } from "bullmq";
import { env } from "./config.ts";
import { logger } from "./logger.ts";
import { redis } from "./redis.ts";
import { runFullSync, runIncrementalSync } from "./sync.ts";

export const syncQueueName = "aed-registry-sync";

type SyncJobName = "full-sync" | "incremental-sync";

const log = logger.child({ module: "scheduler" });

const queue = new Queue<unknown, unknown, SyncJobName>(syncQueueName, {
  connection: redis,
  defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
});

let worker: Worker<unknown, unknown, SyncJobName> | undefined;

export const startScheduler = async (): Promise<void> => {
  worker = new Worker<unknown, unknown, SyncJobName>(
    syncQueueName,
    async (job) => {
      const jobLog = log.child({ jobId: job.id, sync: job.name });
      if (job.name === "full-sync") await runFullSync(jobLog);
      else await runIncrementalSync(jobLog);
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) =>
    log.error({ jobId: job?.id, sync: job?.name, err }, "Sync job failed"),
  );

  // Recurring schedules. concurrency: 1 guarantees full and incremental syncs
  // never overlap.
  await queue.upsertJobScheduler(
    "full-sync",
    { pattern: env.FULL_SYNC_CRON, tz: env.FULL_SYNC_TIMEZONE },
    { name: "full-sync" },
  );
  await queue.upsertJobScheduler(
    "incremental-sync",
    { every: env.INCREMENTAL_SYNC_INTERVAL_MS },
    { name: "incremental-sync" },
  );

  // Bootstrap immediately so a fresh database is populated and downtime is
  // caught up without waiting for the next scheduled run.
  await queue.add("full-sync", {});

  log.info(
    {
      fullSyncCron: env.FULL_SYNC_CRON,
      timezone: env.FULL_SYNC_TIMEZONE,
      incrementalIntervalMs: env.INCREMENTAL_SYNC_INTERVAL_MS,
    },
    "Sync scheduler ready",
  );
};

export const stopScheduler = async (): Promise<void> => {
  await worker?.close();
  await queue.close();
};

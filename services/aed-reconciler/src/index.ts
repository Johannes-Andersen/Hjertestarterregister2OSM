import { Worker } from "bullmq";
import { env } from "./config.ts";
import { closeDatabase } from "./db/index.ts";
import { aedEventSchema } from "./events.ts";
import { logger } from "./logger.ts";
import { closeQueue, DEFERRED_DELETE_JOB } from "./queue.ts";
import { reconcile, runDeferredDelete } from "./reconcile.ts";
import { redis } from "./redis.ts";

const log = logger.child({ module: "bootstrap" });

const worker = new Worker(
  env.QUEUE_NAME,
  async (job) => {
    const event = aedEventSchema.parse(job.data);
    const jobLog = logger.child({
      eventId: event.eventId,
      type: event.type,
      assetId: event.assetId,
    });
    if (job.name === DEFERRED_DELETE_JOB) {
      await runDeferredDelete(event, jobLog);
    } else {
      await reconcile(event, jobLog);
    }
  },
  // Serialize reconciliation so OSM edits never race each other.
  {
    connection: redis,
    concurrency: 1,
    limiter: {
      max: env.WORKER_RATE_LIMIT_MAX,
      duration: env.WORKER_RATE_LIMIT_DURATION_MS,
    },
  },
);

worker.on("failed", (job, err) =>
  log.error({ jobId: job?.id, err }, "Reconciliation job failed"),
);
worker.on("ready", () =>
  log.info(
    {
      queue: env.QUEUE_NAME,
      dry: env.DRY,
      osmApiUrl: env.OSM_API_URL,
      rateLimit: {
        max: env.WORKER_RATE_LIMIT_MAX,
        durationMs: env.WORKER_RATE_LIMIT_DURATION_MS,
      },
    },
    "AED reconciler ready",
  ),
);

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "Starting graceful shutdown");
  await worker.close();
  await closeQueue();
  await redis.quit();
  await closeDatabase();
  log.info("Graceful shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
process.on("uncaughtException", (err) => {
  log.fatal({ err }, "Uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  log.fatal({ err }, "Unhandled promise rejection");
  process.exit(1);
});

log.info(
  { pid: process.pid, node: process.version },
  "Starting AED reconciler",
);

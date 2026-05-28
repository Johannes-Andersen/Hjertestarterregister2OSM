import type { Queue, Worker } from "bullmq";
import type { Logger } from "pino";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

export interface ShutdownTargets {
  workers: { worker: Worker; name: string }[];
  queues: { queue: Queue; name: string }[];
  closeRedis: () => Promise<void>;
  closePostgres: () => Promise<void>;
  log: Logger;
  timeoutMs?: number;
}

const closeWorker = async (
  worker: Worker,
  name: string,
  timeoutMs: number,
  log: Logger,
): Promise<void> => {
  log.info({ worker: name }, "Closing worker");
  const closing = worker.close();
  const timer = setTimeout(() => {
    log.warn(
      { worker: name, timeoutMs },
      "Worker did not finish active jobs in time; cancelling jobs",
    );
    worker.cancelAllJobs("Shutdown timeout");
  }, timeoutMs);

  try {
    await closing;
    log.info({ worker: name }, "Worker closed");
  } catch (err) {
    log.error({ err, worker: name }, "Error closing worker");
  } finally {
    clearTimeout(timer);
  }
};

const closeQueue = async (
  queue: Queue,
  name: string,
  log: Logger,
): Promise<void> => {
  try {
    await queue.close();
    log.info({ queue: name }, "Queue closed");
  } catch (err) {
    log.error({ err, queue: name }, "Error closing queue");
  }
};

export const installShutdownHandlers = ({
  workers,
  queues,
  closeRedis,
  closePostgres,
  log,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
}: ShutdownTargets): void => {
  let shutdownPromise: Promise<void> | null = null;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    log.info(
      { signal },
      "Received shutdown signal; starting graceful shutdown",
    );

    await Promise.all(
      workers.map(({ worker, name }) =>
        closeWorker(worker, name, timeoutMs, log),
      ),
    );

    await Promise.all(
      queues.map(({ queue, name }) => closeQueue(queue, name, log)),
    );

    try {
      await closeRedis();
      log.info("Redis connection closed");
    } catch (err) {
      log.error({ err }, "Error closing Redis connection");
    }

    try {
      await closePostgres();
      log.info("Postgres connection closed");
    } catch (err) {
      log.error({ err }, "Error closing Postgres connection");
    }

    log.info("Graceful shutdown complete");
  };

  const onSignal = (signal: NodeJS.Signals) => {
    if (shutdownPromise) {
      log.warn(
        { signal },
        "Shutdown already in progress; ignoring additional signal",
      );
      return;
    }
    shutdownPromise = shutdown(signal);
    shutdownPromise
      .then(() => process.exit(0))
      .catch((err) => {
        log.fatal({ err }, "Unexpected error during shutdown");
        process.exit(1);
      });
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
};

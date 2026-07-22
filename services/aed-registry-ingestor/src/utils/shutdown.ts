import type { Queue } from "bullmq";
import type { Logger } from "pino";

export interface ShutdownTargets {
  stopScheduling: () => Promise<void>;
  eventQueue: Queue;
  closeRedis: () => Promise<void>;
  closePostgres: () => Promise<void>;
  log: Logger;
}

export const installShutdownHandlers = ({
  stopScheduling,
  eventQueue,
  closeRedis,
  closePostgres,
  log,
}: ShutdownTargets): void => {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "Starting graceful shutdown");

    await stopScheduling();
    await eventQueue.close();
    await closeRedis();
    await closePostgres();

    log.info("Graceful shutdown complete");
  };

  const onSignal = (signal: NodeJS.Signals) => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        log.fatal({ err: error }, "Graceful shutdown failed");
        process.exit(1);
      });
  };

  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
};

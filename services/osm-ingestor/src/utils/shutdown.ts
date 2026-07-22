import type { Logger } from "pino";

export const installShutdownHandlers = ({
  controller,
  log,
}: {
  controller: AbortController;
  log: Logger;
}): void => {
  const onSignal = (signal: NodeJS.Signals) => {
    if (controller.signal.aborted) return;
    log.info({ signal }, "Received shutdown signal");
    controller.abort(new Error(`Service stopped by ${signal}`));
  };

  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
};

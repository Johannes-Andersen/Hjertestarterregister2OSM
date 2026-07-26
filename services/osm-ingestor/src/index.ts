import { closeDatabase, migrateDatabase } from "./db/index.ts";
import { logger } from "./logger.ts";
import { runIngestor } from "./sync.ts";

const log = logger.child({ module: "bootstrap" });
const controller = new AbortController();

const shutdown = (signal: NodeJS.Signals): void => {
  if (controller.signal.aborted) return;
  log.info({ signal }, "Received shutdown signal");
  controller.abort(new Error(`Service stopped by ${signal}`));
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

const main = async (): Promise<void> => {
  log.info(
    { pid: process.pid, node: process.version },
    "Starting OSM ingestor",
  );
  await migrateDatabase();
  await runIngestor(controller.signal, log);
};

main()
  .catch((error) => {
    if (controller.signal.aborted) return;
    log.fatal({ err: error }, "OSM ingestor stopped unexpectedly");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    log.info("OSM ingestor stopped");
  });

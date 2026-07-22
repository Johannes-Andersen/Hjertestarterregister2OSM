import { closeDatabase } from "./clients/postgresClient.ts";
import { migrateDatabase } from "./db/migrate.ts";
import { runService } from "./service.ts";
import { logger } from "./utils/logger.ts";
import { installShutdownHandlers } from "./utils/shutdown.ts";

const log = logger.child({ module: "bootstrap" });
const controller = new AbortController();

installShutdownHandlers({ controller, log });

const main = async () => {
  log.info(
    { nodeVersion: process.version, pid: process.pid },
    "Starting OSM ingestor",
  );
  await migrateDatabase();
  await runService({ log, signal: controller.signal });
};

main()
  .catch((error) => {
    log.fatal({ err: error }, "OSM ingestor stopped unexpectedly");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
    log.info("OSM ingestor stopped");
  });

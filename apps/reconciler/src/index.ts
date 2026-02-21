import { databaseCleanup } from "./jobs/databaseCleanup.ts";
import { runReconciler } from "./jobs/runReconciler.ts";
import { logger } from "./utils/logger.ts";

const log = logger.child({ module: "index" });

const main = async () => {
  await databaseCleanup();

  await runReconciler();
};

main().catch((error) => {
  log.fatal(error, "Reconciler failed");
  process.exitCode = 1;
});

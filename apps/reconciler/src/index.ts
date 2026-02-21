import { randomUUID } from "node:crypto";
import { syncStore } from "./clients/syncStore.ts";
import { reconciliation } from "./jobs/reconciliation.ts";
import { logger } from "./utils/logger.ts";

const log = logger.child({ module: "index" });

const runId = randomUUID();

const main = async () => {
  await reconciliation({ runId });
};

main()
  .catch((error) => {
    log.fatal(error, "Reconciler failed");
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      log.info("Closing sync store client...");
      syncStore.close();
    } catch (err) {
      log.error({ err }, "Failed to close sync store client");
    }
  });

import { databaseCleanup } from "./tasks/databaseCleanup.ts";
import { runReconciler } from "./tasks/runReconciler.ts";

const main = async () => {
  await databaseCleanup();

  await runReconciler();
};

main().catch((error) => {
  console.error("Reconciler failed:", error);
  process.exitCode = 1;
});

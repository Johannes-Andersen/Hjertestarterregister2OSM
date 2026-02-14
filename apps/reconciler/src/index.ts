import { runReconciler } from "./runReconciler.ts";

runReconciler().catch((error) => {
  console.error("Reconciler failed:", error);
  process.exitCode = 1;
});

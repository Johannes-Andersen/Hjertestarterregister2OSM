import type { NewSyncIssue, SyncRunMetrics } from "@repo/sync-store";
import { syncStore } from "./clients/syncStore.ts";
import { reconcilerConfig } from "./config.ts";
import { executeChangePlan } from "./reconciliation/executeChangePlan.ts";
import { runReconciliation } from "./reconciliation/runReconciliation.ts";
import { toErrorMessage } from "./utils/toErrorMessage.ts";

export const runReconciler = async () => {
  const mode = reconcilerConfig.mode;
  const run = await syncStore.startRun({ mode });
  const issues: NewSyncIssue[] = [];
  const metrics: Partial<SyncRunMetrics> = {};
  let issuesPersisted = false;

  console.log(`Running reconciler in ${mode} mode`);

  try {
    const { changePlan, summary } = await runReconciliation({
      mode,
      issues,
      metrics,
    });

    await executeChangePlan({
      mode,
      changePlan,
    });

    await syncStore.replaceRunIssues({
      runId: run.id,
      issues,
    });
    issuesPersisted = true;

    await syncStore.completeRun({
      runId: run.id,
      status: "success",
      metrics,
    });

    console.log("Reconciliation summary:", summary);
    console.log(`Stored run ${run.id} with ${issues.length} issues.`);
  } catch (error) {
    const errorMessage = toErrorMessage(error);

    if (!issuesPersisted) {
      try {
        await syncStore.replaceRunIssues({
          runId: run.id,
          issues,
        });
        issuesPersisted = true;
      } catch (storeIssueError) {
        console.error("Failed to persist run issues:", storeIssueError);
      }
    }

    try {
      await syncStore.completeRun({
        runId: run.id,
        status: "failed",
        errorMessage,
        metrics,
      });
    } catch (storeRunError) {
      console.error("Failed to mark run as failed:", storeRunError);
    }

    throw error;
  } finally {
    try {
      await syncStore.close();
    } catch (closeError) {
      console.error("Failed to close sync-store connection:", closeError);
    }
  }
};

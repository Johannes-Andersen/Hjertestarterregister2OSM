import type { NewSyncIssue, SyncRunMetrics } from "@repo/sync-store";
import { syncStore } from "../clients/syncStore.ts";
import { reconcilerConfig } from "../config.ts";
import { executeChangePlan } from "../reconciliation/executeChangePlan.ts";
import { runReconciliation } from "../reconciliation/runReconciliation.ts";
import { reconciliationLogger } from "../utils/logger.ts";
import { toErrorMessage } from "../utils/toErrorMessage.ts";

const log = reconciliationLogger.child({ job: "runReconciler" });

export const runReconciler = async () => {
  const mode = reconcilerConfig.mode;
  const run = await syncStore.startRun({ mode });
  const issues: NewSyncIssue[] = [];
  const metrics: Partial<SyncRunMetrics> = {};
  let issuesPersisted = false;

  log.info(`Started reconciliation run ${run.id}.`);

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

    log.info(summary, "Reconciliation completed");
    log.info(`Stored run ${run.id} with ${issues.length} issues`);
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
        log.error(storeIssueError, "Failed to persist run issues");
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
      log.error(storeRunError, "Failed to mark run as failed");
    }

    throw error;
  } finally {
    try {
      await syncStore.close();
    } catch (closeError) {
      log.error(closeError, "Failed to close sync-store connection");
    }
  }
};

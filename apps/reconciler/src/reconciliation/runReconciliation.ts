import type {
  NewSyncIssue,
  SyncRunMetrics,
  SyncRunMode,
} from "@repo/sync-store";
import { registerClient } from "../clients/registerClient.ts";
import {
  createReconciliationChangePlan,
  type ReconciliationChangePlan,
} from "../plan/changePlan.ts";
import type { ReconciliationSummary } from "../types/reconciliationSummary.ts";
import { createReconciliationSummary } from "../utils/createReconciliationSummary.ts";
import { loadManagedOsmAeds } from "./loadManagedOsmAeds.ts";
import { loadRegisterAeds } from "./loadRegisterAeds.ts";
import { planCreateAedChanges } from "./tasks/planCreateAedChanges.ts";
import { planDeleteAedChanges } from "./tasks/planDeleteAedChanges.ts";
import { planUpdateAedChanges } from "./tasks/planUpdateAedChanges.ts";

const defaultRegisterMaxRows = 50_000;

interface RunReconciliationArgs {
  mode: SyncRunMode;
  issues: NewSyncIssue[];
  metrics: Partial<SyncRunMetrics>;
}

interface RunReconciliationResult {
  changePlan: ReconciliationChangePlan;
  summary: ReconciliationSummary;
}

export const runReconciliation = async ({
  mode,
  issues,
  metrics,
}: RunReconciliationArgs): Promise<RunReconciliationResult> => {
  const {
    elements,
    managedNodes,
    aedNodeCount,
    issues: osmIssues,
  } = await loadManagedOsmAeds();

  issues.push(...osmIssues);
  metrics.osmAeds = aedNodeCount;

  const registerResponse = await registerClient.searchAssets({
    max_rows: defaultRegisterMaxRows,
  });
  const { registerAedsById, issues: registerIssues } = loadRegisterAeds(
    registerResponse.ASSETS,
  );

  issues.push(...registerIssues);
  metrics.registryAeds = registerAedsById.size;

  console.log(`Found ${registerAedsById.size} unique AEDs in register`);

  const summary = createReconciliationSummary();
  const changePlan = createReconciliationChangePlan();
  const matchedRegisterIds = new Set<string>();
  const elementsForNearbyChecks = [...elements];

  await planDeleteAedChanges({
    mode,
    managedAedNodes: managedNodes,
    registerAedsById,
    changePlan,
    summary,
    issues,
  });

  planUpdateAedChanges({
    mode,
    managedAedNodes: managedNodes,
    registerAedsById,
    matchedRegisterIds,
    elementsForNearbyChecks,
    changePlan,
    summary,
  });

  planCreateAedChanges({
    mode,
    registerAedsById,
    matchedRegisterIds,
    elementsForNearbyChecks,
    changePlan,
    summary,
    issues,
  });

  metrics.linkedAeds = matchedRegisterIds.size;
  metrics.updated = summary.updated;
  metrics.created = summary.created;
  metrics.deleted = summary.deleted;
  metrics.skippedCreateNearby = summary.skippedCreateNearby;
  metrics.skippedDeleteNotAedOnly = summary.skippedDeleteNotAedOnly;
  metrics.unchanged = summary.unchanged;

  return {
    changePlan,
    summary,
  };
};

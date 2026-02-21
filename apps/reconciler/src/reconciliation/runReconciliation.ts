import type { OverpassNode } from "@repo/overpass-sdk";
import type {
  NewSyncIssue,
  SyncRunMetrics,
  SyncRunMode,
} from "@repo/sync-store";
import { registerClient } from "../clients/registerClient.ts";
import { reconcilerConfig } from "../config.ts";
import type { ReconciliationSummary } from "../types/reconciliationSummary.ts";
import { createReconciliationSummary } from "../utils/createReconciliationSummary.ts";
import { reconciliationLogger } from "../utils/logger.ts";
import { loadManagedOsmAeds } from "./loadManagedOsmAeds.ts";
import { loadRegisterAeds } from "./loadRegisterAeds.ts";
import {
  createReconciliationChangePlan,
  type ReconciliationChangePlan,
} from "./plan/changePlan.ts";
import { planCreateAedChanges } from "./tasks/planCreateAedChanges.ts";
import { planDeleteAedChanges } from "./tasks/planDeleteAedChanges.ts";
import { planLinkUnmanagedAedChanges } from "./tasks/planLinkUnmanagedAedChanges.ts";
import { planResolveDuplicateAedChanges } from "./tasks/planResolveDuplicateAedChanges.ts";
import { planUpdateAedChanges } from "./tasks/planUpdateAedChanges.ts";

const log = reconciliationLogger.child({ module: "runReconciliation" });
const defaultRegisterMaxRows = 50_000;

const createMissingRefIssue = (node: OverpassNode): NewSyncIssue => ({
  type: "osm_node_missing_ref",
  severity: "warning",
  message: `Node ${node.id} is missing ref:hjertestarterregister.`,
  osmNodeId: node.id,
  details: {
    tags: node.tags ?? {},
  },
});

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
    duplicateRefGroups,
    unmanagedNodes,
    optedOutRegisterRefs,
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

  log.debug(`Found ${registerAedsById.size} unique AEDs in register`);

  const summary = createReconciliationSummary();
  const changePlan = createReconciliationChangePlan();
  const matchedRegisterIds = new Set<string>();
  for (const ref of optedOutRegisterRefs) {
    matchedRegisterIds.add(ref);
  }
  const elementsForNearbyChecks = [...elements];
  const { deduplicatedManagedNodes } = await planResolveDuplicateAedChanges({
    managedAedNodes: managedNodes,
    duplicateRefGroups,
    registerAedsById,
    elementsForNearbyChecks,
    changePlan,
    summary,
    issues,
  });

  await planDeleteAedChanges({
    managedAedNodes: deduplicatedManagedNodes,
    registerAedsById,
    elementsForNearbyChecks,
    changePlan,
    summary,
    issues,
  });

  await planUpdateAedChanges({
    mode,
    managedAedNodes: deduplicatedManagedNodes,
    registerAedsById,
    matchedRegisterIds,
    elementsForNearbyChecks,
    changePlan,
    summary,
    issues,
  });

  const { linkedUnmanagedNodeIds } = planLinkUnmanagedAedChanges({
    unmanagedAedNodes: unmanagedNodes,
    registerAedsById,
    matchedRegisterIds,
    elementsForNearbyChecks,
    changePlan,
    summary,
    issues,
  });

  for (const node of unmanagedNodes) {
    if (linkedUnmanagedNodeIds.has(node.id)) continue;
    issues.push(createMissingRefIssue(node));
  }

  planCreateAedChanges({
    registerAedsById,
    matchedRegisterIds,
    elementsForNearbyChecks,
    changePlan,
    summary,
    issues,
  });

  // Mass deletion safeguard: abort if too many nodes would be deleted
  if (changePlan.delete.length > 0 && aedNodeCount > 0) {
    const deleteFraction = changePlan.delete.length / aedNodeCount;
    if (deleteFraction > reconcilerConfig.maxDeleteFraction) {
      throw new Error(
        `Aborting: planned ${changePlan.delete.length} deletions out of ${aedNodeCount} OSM AED nodes ` +
          `(${(deleteFraction * 100).toFixed(1)}%) exceeds the safety threshold of ` +
          `${(reconcilerConfig.maxDeleteFraction * 100).toFixed(0)}%.`,
      );
    }
  }

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

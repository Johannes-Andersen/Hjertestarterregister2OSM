import type { OverpassNode } from "@repo/overpass-sdk";
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
import { planLinkUnmanagedAedChanges } from "./tasks/planLinkUnmanagedAedChanges.ts";
import { planResolveDuplicateAedChanges } from "./tasks/planResolveDuplicateAedChanges.ts";
import { planUpdateAedChanges } from "./tasks/planUpdateAedChanges.ts";

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

  console.log(`Found ${registerAedsById.size} unique AEDs in register`);

  const summary = createReconciliationSummary();
  const changePlan = createReconciliationChangePlan();
  const matchedRegisterIds = new Set<string>();
  for (const ref of optedOutRegisterRefs) {
    matchedRegisterIds.add(ref);
  }
  const elementsForNearbyChecks = [...elements];
  const { deduplicatedManagedNodes } = await planResolveDuplicateAedChanges({
    mode,
    managedAedNodes: managedNodes,
    duplicateRefGroups,
    registerAedsById,
    elementsForNearbyChecks,
    changePlan,
    summary,
    issues,
  });

  await planDeleteAedChanges({
    mode,
    managedAedNodes: deduplicatedManagedNodes,
    registerAedsById,
    changePlan,
    summary,
    issues,
  });

  planUpdateAedChanges({
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
    mode,
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

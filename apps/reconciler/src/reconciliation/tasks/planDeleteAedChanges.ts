import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";
import type { NewSyncIssue } from "@repo/sync-store";
import { osmClient } from "../../clients/osmClient.ts";
import type { ReconciliationSummary } from "../../types/reconciliationSummary.ts";
import type { RegisterAed } from "../../types/registerAed.ts";
import { isAedOnlyNode } from "../../utils/isAedOnlyNode.ts";
import { reconciliationLogger } from "../../utils/logger.ts";
import { pruneDeletedNodesFromElements } from "../../utils/nearbyElements.ts";
import type { ReconciliationChangePlan } from "../plan/changePlan.ts";

const registerRefTag = "ref:hjertestarterregister";

interface PlanDeleteAedChangesArgs {
  managedAedNodes: OverpassNode[];
  registerAedsById: Map<string, RegisterAed>;
  elementsForNearbyChecks: OverpassElements[];
  changePlan: ReconciliationChangePlan;
  summary: ReconciliationSummary;
  issues: NewSyncIssue[];
}

const log = reconciliationLogger.child({ task: "planDeleteAedChanges" });

export const planDeleteAedChanges = async ({
  managedAedNodes,
  registerAedsById,
  elementsForNearbyChecks,
  changePlan,
  summary,
  issues,
}: PlanDeleteAedChangesArgs) => {
  const deletedNodeIds = new Set<number>();

  for (const node of managedAedNodes) {
    const ref = node.tags?.[registerRefTag]?.trim();
    if (!ref) continue;

    if (registerAedsById.has(ref)) continue;

    const liveNode = await osmClient.getNodeFeature(node.id);
    if (!isAedOnlyNode(liveNode)) {
      summary.skippedDeleteNotAedOnly++;
      issues.push({
        type: "skipped_delete_not_aed_only",
        severity: "warning",
        message: `Skipped delete of node ${node.id} (${ref}): node has non-AED tags.`,
        registerRef: ref,
        osmNodeId: node.id,
        details: {
          tags: liveNode.tags ?? {},
        },
      });

      log.warn(
        node,
        `Skipping delete of node ${node.id}: node has non-AED tags.`,
      );
      continue;
    }

    changePlan.delete.push({
      registerId: ref,
      node: {
        id: liveNode.id,
        lat: liveNode.lat,
        lon: liveNode.lon,
        version: liveNode.version,
        tags: { ...(liveNode.tags ?? {}) },
      },
    });
    deletedNodeIds.add(node.id);

    log.debug(`Planned delete node ${node.id} (${ref})`);

    summary.deleted++;
  }

  pruneDeletedNodesFromElements({
    elements: elementsForNearbyChecks,
    deletedNodeIds,
  });
};

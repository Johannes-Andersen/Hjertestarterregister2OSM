import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";
import type { NewSyncIssue } from "@repo/sync-store";
import { osmClient } from "../../clients/osmClient.ts";
import type { ReconciliationSummary } from "../../types/reconciliationSummary.ts";
import type { RegisterAed } from "../../types/registerAed.ts";
import { coordinateDistance } from "../../utils/coordinateDistance.ts";
import type { DuplicateRefGroup } from "../../utils/filterDuplicates.ts";
import { isAedOnlyNode } from "../../utils/isAedOnlyNode.ts";
import { logger } from "../../utils/logger.ts";
import { pruneDeletedNodesFromElements } from "../../utils/nearbyElements.ts";
import type { ReconciliationChangePlan } from "../plan/changePlan.ts";

const registerRefTag = "ref:hjertestarterregister";

interface PlanResolveDuplicateAedChangesArgs {
  managedAedNodes: OverpassNode[];
  duplicateRefGroups: DuplicateRefGroup[];
  registerAedsById: Map<string, RegisterAed>;
  elementsForNearbyChecks: OverpassElements[];
  changePlan: ReconciliationChangePlan;
  summary: ReconciliationSummary;
  issues: NewSyncIssue[];
}

interface PlanResolveDuplicateAedChangesResult {
  deduplicatedManagedNodes: OverpassNode[];
}

const log = logger.child({ task: "planResolveDuplicateAedChanges" });

const sortDuplicateNodes = ({
  nodes,
  registerAed,
}: {
  nodes: OverpassNode[];
  registerAed: RegisterAed | undefined;
}) =>
  [...nodes].sort((left, right) => {
    if (registerAed) {
      const leftDistance = coordinateDistance(
        { lat: left.lat, lon: left.lon },
        {
          lat: registerAed.SITE_LATITUDE,
          lon: registerAed.SITE_LONGITUDE,
        },
      );
      const rightDistance = coordinateDistance(
        { lat: right.lat, lon: right.lon },
        {
          lat: registerAed.SITE_LATITUDE,
          lon: registerAed.SITE_LONGITUDE,
        },
      );

      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    }

    return left.id - right.id;
  });

export const planResolveDuplicateAedChanges = async ({
  managedAedNodes,
  duplicateRefGroups,
  registerAedsById,
  elementsForNearbyChecks,
  changePlan,
  summary,
  issues,
}: PlanResolveDuplicateAedChangesArgs): Promise<PlanResolveDuplicateAedChangesResult> => {
  const duplicateRefs = new Set(duplicateRefGroups.map((group) => group.ref));
  const deduplicatedManagedNodes = managedAedNodes.filter((node) => {
    const ref = node.tags?.[registerRefTag]?.trim();
    if (!ref) return false;
    return !duplicateRefs.has(ref);
  });
  const deletedDuplicateNodeIds = new Set<number>();

  for (const duplicateGroup of duplicateRefGroups) {
    const ref = duplicateGroup.ref;
    const registerAed = registerAedsById.get(ref);
    const sortedNodes = sortDuplicateNodes({
      nodes: duplicateGroup.nodes,
      registerAed,
    });
    const [keepNode] = sortedNodes;

    if (keepNode) deduplicatedManagedNodes.push(keepNode);

    const nodesToDelete = keepNode ? sortedNodes.slice(1) : [];

    for (const nodeToDelete of nodesToDelete) {
      const liveNode = await osmClient.getNodeFeature(nodeToDelete.id);
      if (!isAedOnlyNode(liveNode)) {
        summary.skippedDeleteNotAedOnly++;
        issues.push({
          type: "skipped_delete_not_aed_only",
          severity: "warning",
          message: `Skipped duplicate delete of node ${nodeToDelete.id} (${ref}): node has non-AED tags.`,
          registerRef: ref,
          osmNodeId: nodeToDelete.id,
          details: {
            tags: liveNode.tags ?? {},
            reason: "duplicate_ref_resolution",
          },
        });
        log.warn(
          nodeToDelete,
          `Skipping duplicate delete of node ${nodeToDelete.id} (${ref}): node has non-AED tags.`,
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
      deletedDuplicateNodeIds.add(nodeToDelete.id);
      summary.deleted++;

      log.debug(`Planned duplicate delete node ${nodeToDelete.id} (${ref})`);
    }
  }

  pruneDeletedNodesFromElements({
    elements: elementsForNearbyChecks,
    deletedNodeIds: deletedDuplicateNodeIds,
  });

  return {
    deduplicatedManagedNodes,
  };
};

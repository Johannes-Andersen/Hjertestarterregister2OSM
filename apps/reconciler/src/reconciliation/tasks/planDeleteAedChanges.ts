import type { OverpassNode } from "@repo/overpass-sdk";
import type { NewSyncIssue, SyncRunMode } from "@repo/sync-store";
import { osmClient } from "../../clients/osmClient.ts";
import type {
  PlannedNode,
  ReconciliationChangePlan,
} from "../../plan/changePlan.ts";
import type { ReconciliationSummary } from "../../types/reconciliationSummary.ts";
import type { RegisterAed } from "../../types/registerAed.ts";
import { isAedOnlyNode } from "../../utils/isAedOnlyNode.ts";

const registerRefTag = "ref:hjertestarterregister";

interface PlanDeleteAedChangesArgs {
  mode: SyncRunMode;
  managedAedNodes: OverpassNode[];
  registerAedsById: Map<string, RegisterAed>;
  changePlan: ReconciliationChangePlan;
  summary: ReconciliationSummary;
  issues: NewSyncIssue[];
}

const createPlannedNode = (node: OverpassNode): PlannedNode => ({
  id: node.id,
  lat: node.lat,
  lon: node.lon,
  version: node.version,
  tags: { ...(node.tags ?? {}) },
});

export const planDeleteAedChanges = async ({
  mode,
  managedAedNodes,
  registerAedsById,
  changePlan,
  summary,
  issues,
}: PlanDeleteAedChangesArgs) => {
  for (const node of managedAedNodes) {
    const ref = node.tags?.[registerRefTag]?.trim();
    if (!ref) continue;

    if (registerAedsById.has(ref)) continue;

    let deletionCandidateNode: PlannedNode;

    if (mode === "dry-run") {
      if (!isAedOnlyNode(node)) {
        summary.skippedDeleteNotAedOnly++;
        issues.push({
          type: "skipped_delete_not_aed_only",
          severity: "warning",
          message: `Skipped delete of node ${node.id} (${ref}): node has non-AED tags.`,
          registerRef: ref,
          osmNodeId: node.id,
          details: {
            tags: node.tags ?? {},
          },
        });
        console.warn(
          `Skipping delete of node ${node.id} (${ref}): node has non-AED tags.`,
        );
        continue;
      }

      deletionCandidateNode = createPlannedNode(node);
    } else {
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
        console.warn(
          `Skipping delete of node ${node.id} (${ref}): node has non-AED tags.`,
        );
        continue;
      }

      deletionCandidateNode = {
        id: liveNode.id,
        lat: liveNode.lat,
        lon: liveNode.lon,
        version: liveNode.version,
        tags: { ...(liveNode.tags ?? {}) },
      };
    }

    changePlan.delete.push({
      registerId: ref,
      node: deletionCandidateNode,
    });

    console.log(
      `${mode === "dry-run" ? "[dry] Would delete" : "Planned delete"} node ${node.id} (${ref})`,
    );

    summary.deleted++;
  }
};

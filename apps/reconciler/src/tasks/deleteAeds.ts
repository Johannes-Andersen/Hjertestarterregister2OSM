import { OSM } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import type { NewSyncIssue } from "@repo/sync-store";
import { reconcilerConfig } from "../config.ts";
import type { ChangePlan, PlannedNode } from "../dryRun/changePlan.ts";
import type { RegisterAed } from "../register/type.ts";
import { isAedOnlyNode } from "../utils/isAedOnlyNode.ts";
import type { ReconciliationSummary } from "./types.ts";

const registerRefTag = "ref:hjertestarterregister";

interface Arguments {
  filteredAedNodes: OverpassNode[];
  registerAedsById: Map<string, RegisterAed>;
  changePlan: ChangePlan;
  summary: ReconciliationSummary;
  issues: NewSyncIssue[];
}

export const deleteAeds = async ({
  filteredAedNodes,
  registerAedsById,
  changePlan,
  summary,
  issues,
}: Arguments) => {
  for (const node of filteredAedNodes) {
    const ref = node.tags?.[registerRefTag]?.trim();
    if (!ref) continue;

    const registerAed = registerAedsById.get(ref);
    if (registerAed) continue;

    let plannedNode: PlannedNode;

    if (reconcilerConfig.dryRun) {
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

      plannedNode = {
        id: node.id,
        lat: node.lat,
        lon: node.lon,
        version: node.version,
        tags: { ...(node.tags ?? {}) },
      };
    } else {
      const existingNode = await OSM.getNodeFeature(node.id);
      if (!isAedOnlyNode(existingNode)) {
        summary.skippedDeleteNotAedOnly++;
        issues.push({
          type: "skipped_delete_not_aed_only",
          severity: "warning",
          message: `Skipped delete of node ${node.id} (${ref}): node has non-AED tags.`,
          registerRef: ref,
          osmNodeId: node.id,
          details: {
            tags: existingNode.tags ?? {},
          },
        });
        console.warn(
          `Skipping delete of node ${node.id} (${ref}): node has non-AED tags.`,
        );
        continue;
      }

      plannedNode = {
        id: existingNode.id,
        lat: existingNode.lat,
        lon: existingNode.lon,
        version: existingNode.version,
        tags: { ...(existingNode.tags ?? {}) },
      };
    }

    changePlan.delete.push({
      registerId: ref,
      node: plannedNode,
    });

    console.log(
      `${reconcilerConfig.dryRun ? "[dry] Would delete" : "Planned delete"} node ${node.id} (${ref})`,
    );

    summary.deleted++;
  }
};

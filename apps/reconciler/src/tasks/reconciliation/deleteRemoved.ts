import type { PublicRegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { ChangePlan } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import type { Logger } from "pino";
import { osmClient } from "../../clients/osmClient.ts";
import { syncStore } from "../../clients/syncStore.ts";
import { isAedOnlyNode } from "../../utils/isAedOnlyNode.ts";
import { isManagedAed } from "../../utils/isManagedAed.ts";

const registerRefTag = "ref:hjertestarterregister";

interface DeleteRemovedOptions {
  logger: Logger;
  runId: string;
  overpassElements: OverpassNode[];
  registryAssets: PublicRegistryAsset[];
}

export const deleteRemoved = async ({
  logger,
  runId,
  overpassElements,
  registryAssets,
}: DeleteRemovedOptions): Promise<ChangePlan> => {
  const log = logger.child({ task: "deleteRemoved" });
  log.info("Starting deleteRemoved task");

  const changePlan: ChangePlan = {
    create: [],
    modify: [],
    delete: [],
  };

  // Build a set of registry asset GUIDs for fast lookup
  const registryGuids = new Set(
    registryAssets.map((asset) => asset.ASSET_GUID),
  );

  // Find managed OSM nodes whose registry ref no longer exists in the registry
  const managedNodes = overpassElements.filter(isManagedAed);

  for (const node of managedNodes) {
    const ref = node.tags?.[registerRefTag]?.trim();
    if (!ref) continue;

    // Still in the registry — nothing to do
    if (registryGuids.has(ref)) continue;

    // Fetch the live node from OSM to get current version & tags
    const liveNode = await osmClient.getNodeFeature(node.id);

    if (!isAedOnlyNode(liveNode)) {
      log.warn({ node }, "Skipping delete: node has non-AED tags");

      syncStore.addRunIssue({
        runId,
        issue: {
          type: "skipped_delete_not_aed_only",
          severity: "warning",
          message: `Skipped delete of node ${node.id} (${ref}): node has non-AED tags.`,
          registerRef: ref,
          osmNodeId: node.id,
        },
      });

      continue;
    }

    changePlan.delete.push({
      node: {
        id: liveNode.id,
        lat: liveNode.lat,
        lon: liveNode.lon,
        version: liveNode.version,
        tags: { ...(liveNode.tags ?? {}) },
      },
    });

    log.debug({ node }, "Planned delete for removed AED");
  }

  log.info(
    { deletePlanned: changePlan.delete.length },
    "Completed deleteRemoved task",
  );

  return changePlan;
};

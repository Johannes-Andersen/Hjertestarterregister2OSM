import type { PublicRegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { ChangePlan } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import type { Logger } from "pino";
import { syncStore } from "../../clients/syncStore.ts";
import { coordinateDistance } from "../../utils/coordinateDistance.ts";
import { filterDuplicates } from "../../utils/filterDuplicates.ts";
import { isAedOnlyNode } from "../../utils/isAedOnlyNode.ts";
import { isManagedAed } from "../../utils/isManagedAed.ts";

interface ResolveDuplicatesOptions {
  logger: Logger;
  runId: string;
  overpassElements: OverpassNode[];
  registryAssets: PublicRegistryAsset[];
}

export const resolveDuplicates = async ({
  logger,
  runId,
  overpassElements,
  registryAssets,
}: ResolveDuplicatesOptions): Promise<ChangePlan> => {
  const log = logger.child({ task: "resolveDuplicates" });
  log.info("Starting resolveDuplicates task");

  const changePlan: ChangePlan = {
    create: [],
    modify: [],
    delete: [],
  };

  const managedNodes = overpassElements.filter(isManagedAed);
  const { duplicates } = filterDuplicates(managedNodes);

  if (duplicates.length === 0) {
    log.info(
      "Completed resolveDuplicates task with no duplicate ref:hjertestarterregister values found",
    );
    return changePlan;
  }

  // Build a map of registry assets by GUID for distance comparison
  const registryByGuid = new Map(
    registryAssets.map((asset) => [asset.ASSET_GUID, asset]),
  );

  for (const group of duplicates) {
    const registryAsset = registryByGuid.get(group.ref);

    // Sort nodes by distance to the registry location (closest first),
    // falling back to lowest node ID for stable ordering
    const sortedNodes = [...group.nodes].sort((left, right) => {
      if (registryAsset?.SITE_LATITUDE && registryAsset?.SITE_LONGITUDE) {
        const leftDist = coordinateDistance(
          { lat: left.lat, lon: left.lon },
          {
            lat: registryAsset.SITE_LATITUDE,
            lon: registryAsset.SITE_LONGITUDE,
          },
        );
        const rightDist = coordinateDistance(
          { lat: right.lat, lon: right.lon },
          {
            lat: registryAsset.SITE_LATITUDE,
            lon: registryAsset.SITE_LONGITUDE,
          },
        );
        if (leftDist !== rightDist) return leftDist - rightDist;
      }
      return left.id - right.id;
    });

    // Keep the closest node, delete the rest
    const [keepNode, ...nodesToDelete] = sortedNodes;

    log.info(
      {
        ref: group.ref,
        keepNodeId: keepNode?.id,
        deleteNodeIds: nodesToDelete.map((n) => n.id),
      },
      "Resolving duplicate ref group",
    );

    for (const node of nodesToDelete) {
      if (!isAedOnlyNode(node)) {
        log.warn(
          { node, ref: group.ref },
          "Skipping duplicate delete: node has non-AED tags",
        );

        syncStore.addRunIssue({
          runId,
          issue: {
            type: "skipped_delete_not_aed_only",
            severity: "warning",
            message: `Skipped duplicate delete of node ${node.id} (${group.ref}): node has non-AED tags.`,
            registerRef: group.ref,
            osmNodeId: node.id,
          },
        });

        continue;
      }

      changePlan.delete.push({
        node: {
          id: node.id,
          lat: node.lat,
          lon: node.lon,
          version: node.version,
          tags: { ...(node.tags ?? {}) },
        },
      });

      log.debug(
        { node, ref: group.ref },
        "Planned delete for duplicate AED node",
      );
    }
  }

  log.info(
    {
      duplicateGroups: duplicates.length,
      deletePlanned: changePlan.delete.length,
    },
    "Completed resolveDuplicates task",
  );

  return changePlan;
};

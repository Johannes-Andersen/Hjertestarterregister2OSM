import type { PublicRegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { ChangePlan } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import type { Logger } from "pino";
import { osmClient } from "../../clients/osmClient.ts";
import { syncStore } from "../../clients/syncStore.ts";
import { reconcilerConfig } from "../../config.ts";
import { toRegisterAed } from "../../types/registerAed.ts";
import { coordinateDistance } from "../../utils/coordinateDistance.ts";
import { isAedOnlyNode } from "../../utils/isAedOnlyNode.ts";
import { isManagedAed } from "../../utils/isManagedAed.ts";
import { isNodeOptedOut } from "../../utils/isNodeOptedOut.ts";
import { mapRegisterAedToOsmTags } from "../../utils/mapRegisterAedToOsmTags.ts";

interface AddNewOptions {
  logger: Logger;
  runId: string;
  overpassElements: OverpassNode[];
  registryAssets: PublicRegistryAsset[];
}

interface NearbyUnmanagedNode {
  node: OverpassNode;
  distanceMeters: number;
}

/**
 * Find the closest candidate node within the given distance.
 */
const findClosestNode = ({
  lat,
  lon,
  candidates,
  maxDistanceMeters,
}: {
  lat: number;
  lon: number;
  candidates: OverpassNode[];
  maxDistanceMeters: number;
}): NearbyUnmanagedNode | null => {
  let closest: NearbyUnmanagedNode | null = null;

  for (const node of candidates) {
    const distance = coordinateDistance(
      { lat, lon },
      { lat: node.lat, lon: node.lon },
    );

    if (distance > maxDistanceMeters) continue;

    if (!closest || distance < closest.distanceMeters) {
      closest = { node, distanceMeters: distance };
    }
  }

  return closest;
};

export const addNew = async ({
  logger,
  runId,
  overpassElements,
  registryAssets,
}: AddNewOptions): Promise<ChangePlan> => {
  const log = logger.child({ task: "addNew" });
  log.info("Starting addNew task");

  const changePlan: ChangePlan = {
    create: [],
    modify: [],
    delete: [],
  };

  // Build a set of registry refs already managed in OSM
  const managedRefs = new Set(
    overpassElements
      .filter(isManagedAed)
      .map((node) => node.tags?.["ref:hjertestarterregister"]?.trim())
      .filter((ref): ref is string => !!ref),
  );
  const unmanagedNodes = overpassElements.filter((node) => !isManagedAed(node));
  const unmanagedStandaloneNodes = unmanagedNodes.filter(isAedOnlyNode);
  const unmanagedNonStandaloneNodes = unmanagedNodes.filter(
    (node) => !isAedOnlyNode(node),
  );

  for (const asset of registryAssets) {
    const registerAed = toRegisterAed(asset);
    if (!registerAed) continue;

    // Already managed in OSM — handled by updateExisting
    if (managedRefs.has(registerAed.ASSET_GUID)) continue;

    // Check for a close standalone unmanaged node that we can merge with.
    // Mixed POI+AED nodes should first be split by aedExtraction and then
    // matched on a later run.
    const nearbyStandaloneMerge = findClosestNode({
      lat: registerAed.SITE_LATITUDE,
      lon: registerAed.SITE_LONGITUDE,
      candidates: unmanagedStandaloneNodes,
      maxDistanceMeters: reconcilerConfig.unmanagedMergeDistanceMeters,
    });

    if (nearbyStandaloneMerge) {
      // Skip merge if the node is opted out
      if (isNodeOptedOut(nearbyStandaloneMerge.node)) {
        log.info(
          { nearbyNode: nearbyStandaloneMerge, registerAed },
          "Skipping merge: nearby unmanaged node is opted out",
        );

        syncStore.addRunIssue({
          runId,
          issue: {
            type: "osm_node_note_opt_out",
            severity: "warning",
            message: `Skipped merge of register AED ${registerAed.ASSET_GUID} with node ${nearbyStandaloneMerge.node.id} (${nearbyStandaloneMerge.distanceMeters.toFixed(1)}m): node is opted out.`,
            registerRef: registerAed.ASSET_GUID,
            osmNodeId: nearbyStandaloneMerge.node.id,
          },
        });

        continue;
      }

      // Merge: update the unmanaged node with registry info
      const mappedTags = mapRegisterAedToOsmTags(registerAed);
      const liveNode = await osmClient.getNodeFeature(
        nearbyStandaloneMerge.node.id,
      );

      // Guard against stale Overpass data: do not merge into mixed nodes.
      if (!isAedOnlyNode(liveNode)) {
        log.warn(
          { nearbyNode: nearbyStandaloneMerge, registerAed },
          "Skipping merge: live node is no longer standalone AED",
        );
        continue;
      }

      const nextNodeTags = {
        ...(liveNode.tags ?? {}),
        ...mappedTags,
      };

      changePlan.modify.push({
        before: {
          id: liveNode.id,
          lat: liveNode.lat,
          lon: liveNode.lon,
          version: liveNode.version,
          tags: { ...(liveNode.tags ?? {}) },
        },
        after: {
          id: liveNode.id,
          lat: liveNode.lat,
          lon: liveNode.lon,
          version: liveNode.version,
          tags: nextNodeTags,
        },
        tagUpdates: { ...mappedTags },
      });

      log.debug(
        {
          nearbyNode: nearbyStandaloneMerge,
          registerAed,
          distanceMeters: nearbyStandaloneMerge.distanceMeters.toFixed(1),
        },
        "Planned merge with nearby unmanaged AED node",
      );

      continue;
    }

    // If there is a nearby mixed node, wait for extraction to create a
    // standalone AED node, then link it on the next run.
    const nearbyNonStandaloneNode = findClosestNode({
      lat: registerAed.SITE_LATITUDE,
      lon: registerAed.SITE_LONGITUDE,
      candidates: unmanagedNonStandaloneNodes,
      maxDistanceMeters: reconcilerConfig.unmanagedMergeDistanceMeters,
    });
    if (nearbyNonStandaloneNode) {
      log.warn(
        { nearbyNode: nearbyNonStandaloneNode, registerAed },
        "Skipping add: nearby unmanaged node is non-standalone and should be extracted first",
      );
      continue;
    }

    // No nearby unmanaged nodes — create a new AED node
    const mappedTags = mapRegisterAedToOsmTags(registerAed);

    changePlan.create.push({
      node: {
        id: -1,
        lat: registerAed.SITE_LATITUDE,
        lon: registerAed.SITE_LONGITUDE,
        version: 0,
        tags: { ...mappedTags },
      },
    });

    log.debug({ registerAed }, "Planned create for new AED node");
  }

  log.info(
    {
      createPlanned: changePlan.create.length,
      mergePlanned: changePlan.modify.length,
    },
    "Completed addNew task",
  );

  return changePlan;
};

import type { RegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { ChangePlan } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import type { Logger } from "pino";
import { osmClient } from "../../clients/osmClient.ts";
import { syncStore } from "../../clients/syncStore.ts";
import { reconcilerConfig } from "../../config.ts";
import { toRegisterAed } from "../../types/registerAed.ts";
import { coordinateDistance } from "../../utils/coordinateDistance.ts";
import { isManagedAed } from "../../utils/isManagedAed.ts";
import { isNodeOptedOut } from "../../utils/isNodeOptedOut.ts";
import { mapRegisterAedToOsmTags } from "../../utils/mapRegisterAedToOsmTags.ts";

interface AddNewOptions {
  logger: Logger;
  runId: string;
  overpassElements: OverpassNode[];
  registryAssets: RegistryAsset[];
}

interface NearbyUnmanagedNode {
  node: OverpassNode;
  distanceMeters: number;
}

/**
 * Find the closest unmanaged AED node within the given distance.
 */
const findClosestUnmanagedNode = ({
  lat,
  lon,
  overpassElements,
  maxDistanceMeters,
}: {
  lat: number;
  lon: number;
  overpassElements: OverpassNode[];
  maxDistanceMeters: number;
}): NearbyUnmanagedNode | null => {
  let closest: NearbyUnmanagedNode | null = null;

  for (const node of overpassElements) {
    if (isManagedAed(node)) continue;

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

  for (const asset of registryAssets) {
    const registerAed = toRegisterAed(asset);
    if (!registerAed) continue;

    // Already managed in OSM — handled by updateExisting
    if (managedRefs.has(registerAed.ASSET_GUID)) continue;

    // Check for a close unmanaged node that we can merge with
    const nearbyMerge = findClosestUnmanagedNode({
      lat: registerAed.SITE_LATITUDE,
      lon: registerAed.SITE_LONGITUDE,
      overpassElements,
      maxDistanceMeters: reconcilerConfig.unmanagedMergeDistanceMeters,
    });

    if (nearbyMerge) {
      // Skip merge if the node is opted out
      if (isNodeOptedOut(nearbyMerge.node)) {
        log.warn(
          { nearbyNode: nearbyMerge, registerAed },
          "Skipping merge: nearby unmanaged node is opted out",
        );

        syncStore.addRunIssue({
          runId,
          issue: {
            type: "osm_node_note_opt_out",
            severity: "warning",
            message: `Skipped merge of register AED ${registerAed.ASSET_GUID} with node ${nearbyMerge.node.id} (${nearbyMerge.distanceMeters.toFixed(1)}m): node is opted out.`,
            registerRef: registerAed.ASSET_GUID,
            osmNodeId: nearbyMerge.node.id,
          },
        });

        continue;
      }

      // Merge: update the unmanaged node with registry info
      const mappedTags = mapRegisterAedToOsmTags(registerAed);
      const liveNode = await osmClient.getNodeFeature(nearbyMerge.node.id);

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
          nearbyNode: nearbyMerge,
          registerAed,
          distanceMeters: nearbyMerge.distanceMeters.toFixed(1),
        },
        "Planned merge with nearby unmanaged AED node",
      );

      continue;
    }

    // Check if an unmanaged node is nearby but too far to merge — skip creation
    const nearbySkip = findClosestUnmanagedNode({
      lat: registerAed.SITE_LATITUDE,
      lon: registerAed.SITE_LONGITUDE,
      overpassElements,
      maxDistanceMeters: reconcilerConfig.nearbyAedDistanceMeters,
    });

    if (nearbySkip) {
      log.warn(
        {
          registerAed,
          nearbyNode: nearbySkip,
          distanceMeters: nearbySkip.distanceMeters.toFixed(1),
        },
        "Skipping create: nearby unmanaged AED node found",
      );

      syncStore.addRunIssue({
        runId,
        issue: {
          type: "skipped_create_nearby",
          severity: "warning",
          message: `Skipped create for register AED ${registerAed.ASSET_GUID}: nearby unmanaged node ${nearbySkip.node.id} at ${nearbySkip.distanceMeters.toFixed(1)}m.`,
          registerRef: registerAed.ASSET_GUID,
          osmNodeId: nearbySkip.node.id,
          details: {
            distanceMeters: Number(nearbySkip.distanceMeters.toFixed(2)),
          },
        },
      });

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

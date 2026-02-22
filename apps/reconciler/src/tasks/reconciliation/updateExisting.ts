import type { RegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { ChangePlan } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import type { Logger } from "pino";
import { osmClient } from "../../clients/osmClient.ts";
import { syncStore } from "../../clients/syncStore.ts";
import { reconcilerConfig } from "../../config.ts";
import type { AedTags } from "../../types/aedTags.ts";
import { toRegisterAed } from "../../types/registerAed.ts";
import { coordinateDistance } from "../../utils/coordinateDistance.ts";
import { filterDuplicates } from "../../utils/filterDuplicates.ts";
import { isManagedAed } from "../../utils/isManagedAed.ts";
import { isNodeOptedOut } from "../../utils/isNodeOptedOut.ts";
import { mapRegisterAedToOsmTags } from "../../utils/mapRegisterAedToOsmTags.ts";

const registerRefTag = "ref:hjertestarterregister";

interface UpdateExistingOptions {
  logger: Logger;
  runId: string;
  overpassElements: OverpassNode[];
  registryAssets: RegistryAsset[];
}

const getTagUpdates = ({
  currentTags,
  mappedTags,
}: {
  currentTags: Record<string, string>;
  mappedTags: AedTags;
}): Record<string, string | undefined> => {
  const updates: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(mappedTags)) {
    if (value === undefined) continue;
    if (currentTags[key] === value) continue;
    updates[key] = value;
  }

  return updates;
};

export const updateExisting = async ({
  logger,
  runId,
  overpassElements,
  registryAssets,
}: UpdateExistingOptions): Promise<ChangePlan> => {
  const log = logger.child({ task: "updateExisting" });
  log.info("Starting updateExisting task");

  const changePlan: ChangePlan = {
    create: [],
    modify: [],
    delete: [],
  };

  // Build a map of registry assets by GUID
  const registryByGuid = new Map(
    registryAssets
      .map((asset) => {
        const aed = toRegisterAed(asset);
        return aed ? ([aed.ASSET_GUID, aed] as const) : null;
      })
      .filter(
        (
          entry,
        ): entry is readonly [
          string,
          NonNullable<ReturnType<typeof toRegisterAed>>,
        ] => entry !== null,
      ),
  );

  // Identify managed nodes and find duplicates to skip
  const managedNodes = overpassElements.filter(isManagedAed);
  const { duplicates } = filterDuplicates(managedNodes);
  const duplicateRefs = new Set(duplicates.map((group) => group.ref));

  for (const node of managedNodes) {
    const ref = node.tags?.[registerRefTag]?.trim();
    if (!ref) continue;

    // Skip duplicates — they will be resolved by resolveDuplicates first,
    // and updated on the next run
    if (duplicateRefs.has(ref)) {
      log.debug(
        { node },
        "Skipping update: duplicate ref will be resolved separately",
      );
      continue;
    }

    // Skip opted-out nodes
    if (isNodeOptedOut(node)) {
      log.warn({ node }, "Skipping update: node is opted out");

      syncStore.addRunIssue({
        runId,
        issue: {
          type: "osm_node_note_opt_out",
          severity: "warning",
          message: `Node ${node.id} (${ref}) has a note/fixme tag and is excluded from updates.`,
          registerRef: ref,
          osmNodeId: node.id,
        },
      });

      continue;
    }

    const registerAed = registryByGuid.get(ref);
    if (!registerAed) continue;

    const mappedTags = mapRegisterAedToOsmTags(registerAed);
    const tagUpdates = getTagUpdates({
      currentTags: node.tags ?? {},
      mappedTags,
    });
    const hasTagUpdates = Object.keys(tagUpdates).length > 0;

    // Check if location has changed beyond tolerance
    const locationDistanceMeters = coordinateDistance(
      { lat: node.lat, lon: node.lon },
      { lat: registerAed.SITE_LATITUDE, lon: registerAed.SITE_LONGITUDE },
    );
    const shouldMoveNode =
      locationDistanceMeters > reconcilerConfig.changedLocationDistanceMeters;

    // Don't log warnings for location changes less than 2 meters
    if (locationDistanceMeters > 2 && !shouldMoveNode) {
      syncStore.addRunIssue({
        runId,
        issue: {
          type: "managed_node_location_within_tolerance",
          severity: "warning",
          message: `Node ${node.id} (${ref}) is ${locationDistanceMeters.toFixed(1)}m from register location; keeping OSM location.`,
          registerRef: ref,
          osmNodeId: node.id,
          details: {
            distanceMeters: Number(locationDistanceMeters.toFixed(2)),
            maxNoMoveDistanceMeters:
              reconcilerConfig.changedLocationDistanceMeters,
          },
        },
      });
    }

    // Nothing to update
    if (!hasTagUpdates && !shouldMoveNode) continue;

    const nextLat = shouldMoveNode ? registerAed.SITE_LATITUDE : node.lat;
    const nextLon = shouldMoveNode ? registerAed.SITE_LONGITUDE : node.lon;
    const nextNodeTags = {
      ...(node.tags ?? {}),
      ...tagUpdates,
    };

    // Fetch the live node to get the current version for the modify operation
    const liveNode = await osmClient.getNodeFeature(node.id);

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
        lat: nextLat,
        lon: nextLon,
        version: liveNode.version,
        tags: nextNodeTags,
      },
      tagUpdates,
    });

    log.debug(
      {
        node,
        hasTagUpdates,
        shouldMoveNode,
        distanceMeters: locationDistanceMeters.toFixed(1),
      },
      "Planned update for existing AED node",
    );
  }

  log.info(
    { modifyPlanned: changePlan.modify.length },
    "Completed updateExisting task",
  );

  return changePlan;
};

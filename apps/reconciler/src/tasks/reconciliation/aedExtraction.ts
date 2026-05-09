import type { PublicRegistryAsset } from "@repo/hjertestarterregister-sdk";
import type { ChangePlan } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import type { Logger } from "pino";
import { syncStore } from "../../clients/syncStore.ts";
import { reconcilerConfig } from "../../config.ts";
import { coordinateDistance } from "../../utils/coordinateDistance.ts";
import { isAedOnlyNode } from "../../utils/isAedOnlyNode.ts";
import { isManagedAed } from "../../utils/isManagedAed.ts";
import { isNodeOptedOut } from "../../utils/isNodeOptedOut.ts";
import {
  applyTagUpdates,
  buildStandaloneStripTagUpdates,
} from "../../utils/standaloneAed.ts";

interface AedExtractionOptions {
  logger: Logger;
  runId: string;
  overpassElements: OverpassNode[];
  registryAssets: PublicRegistryAsset[];
}

interface RegistryCoordinates {
  lat: number;
  lon: number;
}

/**
 * Find the registry coordinates for a mixed node's AED.
 * For managed nodes, matches by ref. For unmanaged nodes, matches by proximity.
 * Returns null if no matching registry AED is found.
 */
const findRegistryCoordinates = ({
  node,
  registryGuids,
  registryAssets,
  registryWithCoords,
}: {
  node: OverpassNode;
  registryGuids: Set<string>;
  registryAssets: PublicRegistryAsset[];
  registryWithCoords: PublicRegistryAsset[];
}): RegistryCoordinates | null => {
  if (isManagedAed(node)) {
    const ref = node.tags?.["ref:hjertestarterregister"]?.trim();
    if (!ref || !registryGuids.has(ref)) return null;

    const matchingAsset = registryAssets.find(
      (asset) => asset.ASSET_GUID === ref,
    );
    if (!matchingAsset?.SITE_LATITUDE || !matchingAsset?.SITE_LONGITUDE) {
      return null;
    }

    return {
      lat: matchingAsset.SITE_LATITUDE,
      lon: matchingAsset.SITE_LONGITUDE,
    };
  }

  // Unmanaged AED on a mixed node — find the closest nearby registry AED
  let closestAsset: PublicRegistryAsset | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const asset of registryWithCoords) {
    const distance = coordinateDistance(
      { lat: node.lat, lon: node.lon },
      {
        lat: asset.SITE_LATITUDE as number,
        lon: asset.SITE_LONGITUDE as number,
      },
    );
    if (
      distance <= reconcilerConfig.unmanagedMergeDistanceMeters &&
      distance < closestDistance
    ) {
      closestAsset = asset;
      closestDistance = distance;
    }
  }

  if (!closestAsset) return null;

  return {
    lat: closestAsset.SITE_LATITUDE as number,
    lon: closestAsset.SITE_LONGITUDE as number,
  };
};

export const aedExtraction = async ({
  logger,
  runId,
  overpassElements,
  registryAssets,
}: AedExtractionOptions): Promise<ChangePlan> => {
  const log = logger.child({ task: "aedExtraction" });
  log.info("Starting AED extraction process");

  const changePlan: ChangePlan = {
    create: [],
    modify: [],
    delete: [],
  };

  // Build a set of registry GUIDs for matching managed AEDs
  const registryGuids = new Set(
    registryAssets.map((asset) => asset.ASSET_GUID),
  );

  // Build a list of registry assets with valid coordinates for matching
  // unmanaged AEDs by proximity
  const registryWithCoords = registryAssets.filter(
    (asset) =>
      typeof asset.SITE_LATITUDE === "number" &&
      typeof asset.SITE_LONGITUDE === "number",
  );

  for (const node of overpassElements) {
    // Skip AED-only nodes — nothing to extract
    if (isAedOnlyNode(node)) continue;

    // Skip nodes that have opted out via a `note` tag
    if (isNodeOptedOut(node)) {
      log.warn({ node }, "Skipping extraction: node is opted out");

      syncStore.addRunIssue({
        runId,
        issue: {
          type: "osm_node_note_opt_out",
          severity: "warning",
          message: `Node ${node.id} has a note/fixme tag and is excluded from AED extraction.`,
          osmNodeId: node.id,
        },
      });

      continue;
    }

    // Only extract when a matching registry AED exists.
    // For managed nodes, match by ref. For unmanaged nodes, match by proximity.
    const registryCoords = findRegistryCoordinates({
      node,
      registryGuids,
      registryAssets,
      registryWithCoords,
    });

    if (!registryCoords) {
      log.debug(
        { node },
        "Skipping extraction: no matching registry AED found",
      );
      continue;
    }

    // Strip AED-specific tags from the existing node
    const stripUpdates = buildStandaloneStripTagUpdates(node.tags);
    const nextSourceNodeTags = applyTagUpdates({
      currentTags: node.tags ?? {},
      tagUpdates: stripUpdates,
    });

    changePlan.modify.push({
      before: {
        id: node.id,
        lat: node.lat,
        lon: node.lon,
        version: node.version,
        tags: { ...(node.tags ?? {}) },
      },
      after: {
        id: node.id,
        lat: node.lat,
        lon: node.lon,
        version: node.version,
        tags: nextSourceNodeTags,
      },
    });

    // Collect the AED tags from the existing node into a new standalone node,
    // placed at the registry coordinates instead of the parent node's location
    const aedTags: Record<string, string> = {};
    for (const key of Object.keys(stripUpdates)) {
      const value = node.tags?.[key];
      if (value !== undefined) {
        aedTags[key] = value;
      }
    }

    changePlan.create.push({
      node: {
        id: -1,
        lat: registryCoords.lat,
        lon: registryCoords.lon,
        version: 0,
        tags: aedTags,
      },
    });

    log.debug({ node }, "Planned AED extraction from non-standalone node");
  }

  log.info(
    {
      modifyPlanned: changePlan.modify.length,
      createPlanned: changePlan.create.length,
    },
    "Completed aedExtraction task",
  );

  return changePlan;
};

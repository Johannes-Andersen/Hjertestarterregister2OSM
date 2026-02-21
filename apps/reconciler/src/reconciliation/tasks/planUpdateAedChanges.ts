import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";
import type { NewSyncIssue, SyncRunMode } from "@repo/sync-store";
import { osmClient } from "../../clients/osmClient.ts";
import { reconcilerConfig } from "../../config.ts";
import type { ReconciliationSummary } from "../../types/reconciliationSummary.ts";
import type { RegisterAed } from "../../types/registerAed.ts";
import { coordinateDistance } from "../../utils/coordinateDistance.ts";
import { logger } from "../../utils/logger.ts";
import { mapRegisterAedToOsmTags } from "../../utils/mapRegisterAedToOsmTags.ts";
import { buildNodeElementIndex } from "../../utils/nearbyElements.ts";
import {
  applyTagUpdates,
  buildStandaloneStripTagUpdates,
  hasStandaloneConflictTags,
  listStandaloneConflictTagKeys,
} from "../../utils/standaloneAed.ts";
import type { ReconciliationChangePlan } from "../plan/changePlan.ts";

interface PlanUpdateAedChangesArgs {
  mode: SyncRunMode;
  managedAedNodes: OverpassNode[];
  registerAedsById: Map<string, RegisterAed>;
  matchedRegisterIds: Set<string>;
  elementsForNearbyChecks: OverpassElements[];
  changePlan: ReconciliationChangePlan;
  summary: ReconciliationSummary;
  issues: NewSyncIssue[];
}

const log = logger.child({ task: "planUpdateAedChanges" });

const registerRefTag = "ref:hjertestarterregister";
const locationDifferenceEpsilonMeters = 0.01;

const getTagUpdates = ({
  currentTags,
  mappedTags,
}: {
  currentTags: Record<string, string>;
  mappedTags: ReturnType<typeof mapRegisterAedToOsmTags>;
}): Record<string, string> => {
  const updates: Record<string, string> = {};

  for (const [key, value] of Object.entries(mappedTags)) {
    if (value === undefined) continue;
    if (currentTags[key] === value) continue;
    updates[key] = value;
  }

  return updates;
};

export const planUpdateAedChanges = async ({
  mode,
  managedAedNodes,
  registerAedsById,
  matchedRegisterIds,
  elementsForNearbyChecks,
  changePlan,
  summary,
  issues,
}: PlanUpdateAedChangesArgs) => {
  const nodeElementIndex = buildNodeElementIndex(elementsForNearbyChecks);

  for (const node of managedAedNodes) {
    const ref = node.tags?.[registerRefTag]?.trim();
    if (!ref) continue;

    const registerAed = registerAedsById.get(ref);
    if (!registerAed) continue;

    matchedRegisterIds.add(registerAed.ASSET_GUID);

    const mappedTags = mapRegisterAedToOsmTags(registerAed);

    // Determine standalone conflict, using live data in live mode for accuracy
    let effectiveTags = node.tags ?? {};
    let standaloneConflict = hasStandaloneConflictTags(node.tags);

    if (standaloneConflict && mode === "live") {
      const liveNode = await osmClient.getNodeFeature(node.id);
      effectiveTags = liveNode.tags ?? {};
      standaloneConflict = hasStandaloneConflictTags(effectiveTags);
    }

    if (standaloneConflict) {
      const stripUpdates = buildStandaloneStripTagUpdates(effectiveTags);
      const nextSourceNodeTags = applyTagUpdates({
        currentTags: effectiveTags,
        tagUpdates: stripUpdates,
      });
      const createdNodeId = -1 * (summary.created + 1);

      changePlan.modify.push({
        registerId: registerAed.ASSET_GUID,
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
        tagUpdates: stripUpdates,
      });

      changePlan.create.push({
        registerId: registerAed.ASSET_GUID,
        node: {
          id: createdNodeId,
          lat: registerAed.SITE_LATITUDE,
          lon: registerAed.SITE_LONGITUDE,
          version: 0,
          tags: { ...mappedTags },
        },
      });

      issues.push({
        type: "aed_split_non_standalone_node",
        severity: "warning",
        message: `Split AED from non-standalone node ${node.id} (${registerAed.ASSET_GUID}); created dedicated AED node.`,
        registerRef: registerAed.ASSET_GUID,
        osmNodeId: node.id,
        details: {
          conflictTagKeys: listStandaloneConflictTagKeys(effectiveTags),
        },
      });

      const elementIndex = nodeElementIndex.get(node.id);
      if (elementIndex !== undefined) {
        elementsForNearbyChecks[elementIndex] = {
          type: "node",
          id: createdNodeId,
          lat: registerAed.SITE_LATITUDE,
          lon: registerAed.SITE_LONGITUDE,
          tags: { ...mappedTags },
        };
      }

      summary.updated++;
      summary.created++;

      log.debug(
        `Planned split non-standalone node ${node.id} for register AED ${registerAed.ASSET_GUID}`,
      );

      continue;
    }

    const tagUpdates = getTagUpdates({
      currentTags: node.tags ?? {},
      mappedTags,
    });
    const hasTagUpdates = Object.keys(tagUpdates).length > 0;

    const locationDistanceMeters = coordinateDistance(
      { lat: node.lat, lon: node.lon },
      { lat: registerAed.SITE_LATITUDE, lon: registerAed.SITE_LONGITUDE },
    );
    const hasLocationDifference =
      locationDistanceMeters > locationDifferenceEpsilonMeters;
    const shouldMoveNode =
      locationDistanceMeters > reconcilerConfig.changedLocationDistanceMeters;

    if (hasLocationDifference && !shouldMoveNode) {
      issues.push({
        type: "managed_node_location_within_tolerance",
        severity: "warning",
        message: `Node ${node.id} (${registerAed.ASSET_GUID}) is ${locationDistanceMeters.toFixed(1)}m from register location; keeping OSM location.`,
        registerRef: registerAed.ASSET_GUID,
        osmNodeId: node.id,
        details: {
          distanceMeters: Number(locationDistanceMeters.toFixed(2)),
          maxNoMoveDistanceMeters:
            reconcilerConfig.changedLocationDistanceMeters,
          osmLocation: { lat: node.lat, lon: node.lon },
          registerLocation: {
            lat: registerAed.SITE_LATITUDE,
            lon: registerAed.SITE_LONGITUDE,
          },
        },
      });
    }

    if (!hasTagUpdates && !shouldMoveNode) {
      summary.unchanged++;
      continue;
    }

    const nextNodeTags = {
      ...(node.tags ?? {}),
      ...tagUpdates,
    };
    const nextLat = shouldMoveNode ? registerAed.SITE_LATITUDE : node.lat;
    const nextLon = shouldMoveNode ? registerAed.SITE_LONGITUDE : node.lon;

    changePlan.modify.push({
      registerId: registerAed.ASSET_GUID,
      before: {
        id: node.id,
        lat: node.lat,
        lon: node.lon,
        version: node.version,
        tags: { ...(node.tags ?? {}) },
      },
      after: {
        id: node.id,
        lat: nextLat,
        lon: nextLon,
        version: node.version,
        tags: nextNodeTags,
      },
      tagUpdates,
    });

    log.debug(
      `Planned update node ${node.id} for register AED ${registerAed.ASSET_GUID}`,
    );

    const elementIndex = nodeElementIndex.get(node.id);
    if (elementIndex !== undefined) {
      elementsForNearbyChecks[elementIndex] = {
        ...node,
        lat: nextLat,
        lon: nextLon,
        tags: nextNodeTags,
      };
    }

    summary.updated++;
  }
};

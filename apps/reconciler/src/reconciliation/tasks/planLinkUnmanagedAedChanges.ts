import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";
import type { NewSyncIssue, SyncRunMode } from "@repo/sync-store";
import { reconcilerConfig } from "../../config.ts";
import type { ReconciliationChangePlan } from "../../plan/changePlan.ts";
import type { ReconciliationSummary } from "../../types/reconciliationSummary.ts";
import type { RegisterAed } from "../../types/registerAed.ts";
import { coordinateDistance } from "../../utils/coordinateDistance.ts";
import { mapRegisterAedToOsmTags } from "../../utils/mapRegisterAedToOsmTags.ts";
import { buildNodeElementIndex } from "../../utils/nearbyElements.ts";
import {
  applyTagUpdates,
  buildStandaloneStripTagUpdates,
  hasStandaloneConflictTags,
  listStandaloneConflictTagKeys,
} from "../../utils/standaloneAed.ts";

interface PlanLinkUnmanagedAedChangesArgs {
  mode: SyncRunMode;
  unmanagedAedNodes: OverpassNode[];
  registerAedsById: Map<string, RegisterAed>;
  matchedRegisterIds: Set<string>;
  elementsForNearbyChecks: OverpassElements[];
  changePlan: ReconciliationChangePlan;
  summary: ReconciliationSummary;
  issues: NewSyncIssue[];
}

interface PlanLinkUnmanagedAedChangesResult {
  linkedUnmanagedNodeIds: Set<number>;
}

interface LinkCandidate {
  node: OverpassNode;
  registerAed: RegisterAed;
  distanceMeters: number;
}

const findUnmatchedRegisterAedsInRange = ({
  node,
  registerAedsById,
  matchedRegisterIds,
}: {
  node: OverpassNode;
  registerAedsById: Map<string, RegisterAed>;
  matchedRegisterIds: Set<string>;
}): { registerAed: RegisterAed; distanceMeters: number }[] => {
  const candidates: { registerAed: RegisterAed; distanceMeters: number }[] = [];

  for (const registerAed of registerAedsById.values()) {
    if (matchedRegisterIds.has(registerAed.ASSET_GUID)) continue;

    const distanceMeters = coordinateDistance(
      { lat: node.lat, lon: node.lon },
      { lat: registerAed.SITE_LATITUDE, lon: registerAed.SITE_LONGITUDE },
    );

    if (distanceMeters > reconcilerConfig.unmanagedMergeDistanceMeters) {
      continue;
    }

    candidates.push({ registerAed, distanceMeters });
  }

  return candidates;
};

export const planLinkUnmanagedAedChanges = ({
  mode,
  unmanagedAedNodes,
  registerAedsById,
  matchedRegisterIds,
  elementsForNearbyChecks,
  changePlan,
  summary,
  issues,
}: PlanLinkUnmanagedAedChangesArgs): PlanLinkUnmanagedAedChangesResult => {
  const nodeElementIndex = buildNodeElementIndex(elementsForNearbyChecks);
  const linkCandidates: LinkCandidate[] = [];
  const linkedUnmanagedNodeIds = new Set<number>();

  for (const node of unmanagedAedNodes) {
    const candidates = findUnmatchedRegisterAedsInRange({
      node,
      registerAedsById,
      matchedRegisterIds,
    });

    for (const candidate of candidates) {
      linkCandidates.push({
        node,
        registerAed: candidate.registerAed,
        distanceMeters: candidate.distanceMeters,
      });
    }
  }

  linkCandidates.sort(
    (left, right) => left.distanceMeters - right.distanceMeters,
  );

  for (const linkCandidate of linkCandidates) {
    if (linkedUnmanagedNodeIds.has(linkCandidate.node.id)) continue;
    if (matchedRegisterIds.has(linkCandidate.registerAed.ASSET_GUID)) continue;

    const mappedTags = mapRegisterAedToOsmTags(linkCandidate.registerAed);
    const hasStandaloneConflict = hasStandaloneConflictTags(
      linkCandidate.node.tags,
    );

    if (hasStandaloneConflict) {
      const stripUpdates = buildStandaloneStripTagUpdates(
        linkCandidate.node.tags,
      );
      const nextSourceNodeTags = applyTagUpdates({
        currentTags: linkCandidate.node.tags ?? {},
        tagUpdates: stripUpdates,
      });
      const createdNodeId = -1 * (summary.created + 1);

      changePlan.modify.push({
        registerId: linkCandidate.registerAed.ASSET_GUID,
        before: {
          id: linkCandidate.node.id,
          lat: linkCandidate.node.lat,
          lon: linkCandidate.node.lon,
          version: linkCandidate.node.version,
          tags: { ...(linkCandidate.node.tags ?? {}) },
        },
        after: {
          id: linkCandidate.node.id,
          lat: linkCandidate.node.lat,
          lon: linkCandidate.node.lon,
          version: linkCandidate.node.version,
          tags: nextSourceNodeTags,
        },
        tagUpdates: stripUpdates,
      });

      changePlan.create.push({
        registerId: linkCandidate.registerAed.ASSET_GUID,
        node: {
          id: createdNodeId,
          lat: linkCandidate.registerAed.SITE_LATITUDE,
          lon: linkCandidate.registerAed.SITE_LONGITUDE,
          version: 0,
          tags: { ...mappedTags },
        },
      });

      issues.push({
        type: "aed_split_non_standalone_node",
        severity: "warning",
        message: `Split AED from non-standalone node ${linkCandidate.node.id} (${linkCandidate.registerAed.ASSET_GUID}); created dedicated AED node.`,
        registerRef: linkCandidate.registerAed.ASSET_GUID,
        osmNodeId: linkCandidate.node.id,
        details: {
          conflictTagKeys: listStandaloneConflictTagKeys(
            linkCandidate.node.tags ?? {},
          ),
        },
      });

      const elementIndex = nodeElementIndex.get(linkCandidate.node.id);
      if (elementIndex !== undefined) {
        elementsForNearbyChecks[elementIndex] = {
          type: "node",
          id: createdNodeId,
          lat: linkCandidate.registerAed.SITE_LATITUDE,
          lon: linkCandidate.registerAed.SITE_LONGITUDE,
          tags: { ...mappedTags },
        };
      }

      matchedRegisterIds.add(linkCandidate.registerAed.ASSET_GUID);
      linkedUnmanagedNodeIds.add(linkCandidate.node.id);
      summary.updated++;
      summary.created++;

      console.log(
        `${mode === "dry-run" ? "[dry] Would split" : "Planned split"} non-standalone unmanaged node ${linkCandidate.node.id} for register AED ${linkCandidate.registerAed.ASSET_GUID}`,
      );

      continue;
    }

    const nextNodeTags = {
      ...(linkCandidate.node.tags ?? {}),
      ...mappedTags,
    };

    changePlan.modify.push({
      registerId: linkCandidate.registerAed.ASSET_GUID,
      before: {
        id: linkCandidate.node.id,
        lat: linkCandidate.node.lat,
        lon: linkCandidate.node.lon,
        version: linkCandidate.node.version,
        tags: { ...(linkCandidate.node.tags ?? {}) },
      },
      after: {
        id: linkCandidate.node.id,
        lat: linkCandidate.node.lat,
        lon: linkCandidate.node.lon,
        version: linkCandidate.node.version,
        tags: nextNodeTags,
      },
      tagUpdates: { ...mappedTags },
    });

    const elementIndex = nodeElementIndex.get(linkCandidate.node.id);
    if (elementIndex !== undefined) {
      elementsForNearbyChecks[elementIndex] = {
        ...linkCandidate.node,
        tags: nextNodeTags,
      };
    }

    matchedRegisterIds.add(linkCandidate.registerAed.ASSET_GUID);
    linkedUnmanagedNodeIds.add(linkCandidate.node.id);
    summary.updated++;

    console.log(
      `${mode === "dry-run" ? "[dry] Would auto-link" : "Planned auto-link"} unmanaged node ${linkCandidate.node.id} to register AED ${linkCandidate.registerAed.ASSET_GUID} (${linkCandidate.distanceMeters.toFixed(1)}m)`,
    );
  }

  return {
    linkedUnmanagedNodeIds,
  };
};

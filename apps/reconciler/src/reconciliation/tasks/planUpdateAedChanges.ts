import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";
import type { SyncRunMode } from "@repo/sync-store";
import { reconcilerConfig } from "../../config.ts";
import type { ReconciliationChangePlan } from "../../plan/changePlan.ts";
import type { ReconciliationSummary } from "../../types/reconciliationSummary.ts";
import type { RegisterAed } from "../../types/registerAed.ts";
import { hasAedChanged } from "../../utils/hasAedChanged.ts";
import { mapRegisterAedToOsmTags } from "../../utils/mapRegisterAedToOsmTags.ts";

const registerRefTag = "ref:hjertestarterregister";

const buildNodeElementIndex = (elements: OverpassElements[]) => {
  const indexByNodeId = new Map<number, number>();

  for (const [index, element] of elements.entries()) {
    if (element.type !== "node") continue;
    indexByNodeId.set(element.id, index);
  }

  return indexByNodeId;
};

interface PlanUpdateAedChangesArgs {
  mode: SyncRunMode;
  managedAedNodes: OverpassNode[];
  registerAedsById: Map<string, RegisterAed>;
  matchedRegisterIds: Set<string>;
  elementsForNearbyChecks: OverpassElements[];
  changePlan: ReconciliationChangePlan;
  summary: ReconciliationSummary;
}

export const planUpdateAedChanges = ({
  mode,
  managedAedNodes,
  registerAedsById,
  matchedRegisterIds,
  elementsForNearbyChecks,
  changePlan,
  summary,
}: PlanUpdateAedChangesArgs) => {
  const nodeElementIndex = buildNodeElementIndex(elementsForNearbyChecks);

  for (const node of managedAedNodes) {
    const ref = node.tags?.[registerRefTag]?.trim();
    if (!ref) continue;

    const registerAed = registerAedsById.get(ref);
    if (!registerAed) continue;

    matchedRegisterIds.add(registerAed.ASSET_GUID);

    const mappedTags = mapRegisterAedToOsmTags(registerAed);
    const nextNodeTags = {
      ...(node.tags ?? {}),
      ...mappedTags,
    };

    const changed = hasAedChanged({
      oldNode: node,
      aedInfo: registerAed,
      expectedTags: mappedTags,
      locationDistanceMeters: reconcilerConfig.changedLocationDistanceMeters,
    });

    if (!changed) {
      summary.unchanged++;
      continue;
    }

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
        lat: registerAed.SITE_LATITUDE,
        lon: registerAed.SITE_LONGITUDE,
        version: node.version,
        tags: nextNodeTags,
      },
      tagUpdates: { ...mappedTags },
    });

    console.log(
      `${mode === "dry-run" ? "[dry] Would update" : "Planned update"} node ${node.id} for register AED ${registerAed.ASSET_GUID}`,
    );

    const elementIndex = nodeElementIndex.get(node.id);
    if (elementIndex !== undefined) {
      elementsForNearbyChecks[elementIndex] = {
        ...node,
        lat: registerAed.SITE_LATITUDE,
        lon: registerAed.SITE_LONGITUDE,
        tags: nextNodeTags,
      };
    }

    summary.updated++;
  }
};

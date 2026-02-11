import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";
import { reconcilerConfig } from "../config.ts";
import type { ChangePlan } from "../dryRun/changePlan.ts";
import type { RegisterAed } from "../register/type.ts";
import { hasAedChanged } from "../utils/hasAedChanged.ts";
import { mapRegisterAedToOsmTags } from "../utils/mapRegisterAedToOsmTags.ts";
import type { ReconciliationSummary } from "./types.ts";

const registerRefTag = "ref:hjertestarterregister";

const updateNodeInElements = ({
  elements,
  nodeId,
  nextNode,
}: {
  elements: OverpassElements[];
  nodeId: number;
  nextNode: OverpassNode;
}) => {
  const elementIndex = elements.findIndex(
    (element) => element.type === "node" && element.id === nodeId,
  );

  if (elementIndex >= 0) elements[elementIndex] = nextNode;
};

interface Arguments {
  filteredAedNodes: OverpassNode[];
  registerAedsById: Map<string, RegisterAed>;
  matchedRegisterIds: Set<string>;
  elementsForNearbyChecks: OverpassElements[];
  changePlan: ChangePlan;
  summary: ReconciliationSummary;
}

export const updateAeds = async ({
  filteredAedNodes,
  registerAedsById,
  matchedRegisterIds,
  elementsForNearbyChecks,
  changePlan,
  summary,
}: Arguments) => {
  for (const node of filteredAedNodes) {
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
      `${reconcilerConfig.dryRun ? "[dry] Would update" : "Planned update"} node ${node.id} for register AED ${registerAed.ASSET_GUID}`,
    );

    updateNodeInElements({
      elements: elementsForNearbyChecks,
      nodeId: node.id,
      nextNode: {
        ...node,
        lat: registerAed.SITE_LATITUDE,
        lon: registerAed.SITE_LONGITUDE,
        tags: nextNodeTags,
      },
    });

    summary.updated++;
  }
};

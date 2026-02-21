import type { ChangePlan } from "@repo/osm-sdk";
import type { OverpassNode } from "@repo/overpass-sdk";
import type { Logger } from "pino";
import { osmClient } from "../../clients/osmClient.ts";
import { syncStore } from "../../clients/syncStore.ts";
import { isAedOnlyNode } from "../../utils/isAedOnlyNode.ts";
import { isNodeOptedOut } from "../../utils/isNodeOptedOut.ts";
import {
  applyTagUpdates,
  buildStandaloneStripTagUpdates,
} from "../../utils/standaloneAed.ts";

interface AedExtractionOptions {
  logger: Logger;
  runId: string;
  overpassElements: OverpassNode[];
}

export const aedExtraction = async ({
  logger,
  runId,
  overpassElements,
}: AedExtractionOptions): Promise<ChangePlan> => {
  const log = logger.child({ task: "aedExtraction" });
  log.info("Starting AED extraction process");

  const changePlan: ChangePlan = {
    create: [],
    modify: [],
    delete: [],
  };

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
          message: `Node ${node.id} has a note tag and is excluded from AED extraction.`,
          osmNodeId: node.id,
        },
      });

      continue;
    }

    // Fetch the live node from OSM to get current version & tags
    const liveNode = await osmClient.getNodeFeature(node.id);

    // Re-check against live data
    if (isAedOnlyNode(liveNode)) continue;

    // Strip AED-specific tags from the existing node
    const stripUpdates = buildStandaloneStripTagUpdates(liveNode.tags);
    const nextSourceNodeTags = applyTagUpdates({
      currentTags: liveNode.tags ?? {},
      tagUpdates: stripUpdates,
    });

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
        tags: nextSourceNodeTags,
      },
      tagUpdates: stripUpdates,
    });

    // Collect the AED tags from the existing node into a new standalone node
    const aedTags: Record<string, string> = {};
    for (const key of Object.keys(stripUpdates)) {
      const value = liveNode.tags?.[key];
      if (value !== undefined) {
        aedTags[key] = value;
      }
    }

    changePlan.create.push({
      node: {
        id: -1,
        lat: liveNode.lat,
        lon: liveNode.lon,
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

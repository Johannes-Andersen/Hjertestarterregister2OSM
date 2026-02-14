import type { OsmNode } from "@repo/osm-sdk";
import { hasStandaloneConflictTags } from "./standaloneAed.ts";

/**
 * A node is considered "AED-only" when it is a defibrillator node that does
 * not also serve as a primary-feature POI (amenity, shop, etc.).
 *
 * Uses the same conflict-tag denylist as the standalone-split logic so that
 * both checks stay in sync.
 */
export const isAedOnlyNode = (node: Pick<OsmNode, "tags">) => {
  const tags = node.tags;
  if (!tags) return false;

  if (!tags.emergency) return false;
  if (!["defibrillator", "aed"].includes(tags.emergency)) return false;

  return !hasStandaloneConflictTags(tags);
};

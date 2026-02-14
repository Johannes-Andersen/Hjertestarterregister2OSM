import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";
import type { NewSyncIssue } from "@repo/sync-store";
import { filterDuplicates } from "../utils/filterDuplicates.ts";
import { getOsmAeds } from "../utils/getOsmAeds.ts";
import { isManagedAed } from "../utils/isManagedAed.ts";
import { isOverpassNode } from "../utils/isOverpassNode.ts";

interface ManagedOsmAedSnapshot {
  elements: OverpassElements[];
  managedNodes: OverpassNode[];
  aedNodeCount: number;
  issues: NewSyncIssue[];
}

const createMissingRefIssue = (node: OverpassNode): NewSyncIssue => ({
  type: "osm_node_missing_ref",
  severity: "warning",
  message: `Node ${node.id} is missing ref:hjertestarterregister.`,
  osmNodeId: node.id,
  details: {
    tags: node.tags ?? {},
  },
});

const createDuplicateRefIssue = ({
  ref,
  nodeIds,
}: {
  ref: string;
  nodeIds: number[];
}): NewSyncIssue => ({
  type: "osm_duplicate_register_ref",
  severity: "error",
  message: `Duplicate ref:hjertestarterregister=${ref} found on nodes ${nodeIds.join(", ")}.`,
  registerRef: ref,
  details: {
    nodeIds,
  },
});

export const loadManagedOsmAeds = async (): Promise<ManagedOsmAedSnapshot> => {
  const { elements } = await getOsmAeds();

  console.log(`Found ${elements.length} AED elements`);

  const aedNodes = elements.filter(isOverpassNode);
  if (aedNodes.length === 0) {
    throw new Error("No AED nodes found");
  }

  console.log(`Found ${aedNodes.length} AED nodes`);

  const managedNodes: OverpassNode[] = [];
  const issues: NewSyncIssue[] = [];

  for (const node of aedNodes) {
    if (isManagedAed(node)) {
      managedNodes.push(node);
      continue;
    }

    issues.push(createMissingRefIssue(node));
  }

  console.log(`Found ${managedNodes.length} managed AED nodes`);

  const duplicateFilterResult = filterDuplicates(managedNodes);

  for (const duplicate of duplicateFilterResult.duplicates) {
    issues.push(createDuplicateRefIssue(duplicate));
  }

  console.log(
    `Found ${duplicateFilterResult.uniqueNodes.length} unique managed AED nodes`,
  );

  return {
    elements,
    managedNodes: duplicateFilterResult.uniqueNodes,
    aedNodeCount: aedNodes.length,
    issues,
  };
};

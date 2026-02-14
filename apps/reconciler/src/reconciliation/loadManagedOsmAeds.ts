import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";
import type { NewSyncIssue } from "@repo/sync-store";
import {
  type DuplicateRefGroup,
  filterDuplicates,
} from "../utils/filterDuplicates.ts";
import { getOsmAeds } from "../utils/getOsmAeds.ts";
import { isManagedAed } from "../utils/isManagedAed.ts";
import { isNodeOptedOut } from "../utils/isNodeOptedOut.ts";
import { isOverpassNode } from "../utils/isOverpassNode.ts";

interface ManagedOsmAedSnapshot {
  elements: OverpassElements[];
  managedNodes: OverpassNode[];
  duplicateRefGroups: DuplicateRefGroup[];
  unmanagedNodes: OverpassNode[];
  optedOutRegisterRefs: Set<string>;
  aedNodeCount: number;
  issues: NewSyncIssue[];
}

const createNoteOptOutIssue = (node: OverpassNode): NewSyncIssue => ({
  type: "osm_node_note_opt_out",
  severity: "warning",
  message: `Node ${node.id} has note tag and is opted out from automation.`,
  registerRef: node.tags?.["ref:hjertestarterregister"]?.trim() || undefined,
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
  const unmanagedNodes: OverpassNode[] = [];
  const optedOutRegisterRefs = new Set<string>();
  const issues: NewSyncIssue[] = [];

  for (const node of aedNodes) {
    if (isNodeOptedOut(node)) {
      const registerRef = node.tags?.["ref:hjertestarterregister"]?.trim();
      if (registerRef) {
        optedOutRegisterRefs.add(registerRef);
      }
      issues.push(createNoteOptOutIssue(node));
      continue;
    }

    if (isManagedAed(node)) {
      managedNodes.push(node);
      continue;
    }

    unmanagedNodes.push(node);
  }

  console.log(`Found ${managedNodes.length} managed AED nodes`);
  console.log(`Found ${unmanagedNodes.length} unmanaged AED nodes`);

  const duplicateFilterResult = filterDuplicates(managedNodes);

  for (const duplicate of duplicateFilterResult.duplicates) {
    issues.push(createDuplicateRefIssue(duplicate));
  }

  console.log(
    `Found ${duplicateFilterResult.uniqueNodes.length} unique managed AED nodes`,
  );
  console.log(
    `Found ${duplicateFilterResult.duplicates.length} duplicate managed refs`,
  );

  return {
    elements,
    managedNodes,
    duplicateRefGroups: duplicateFilterResult.duplicates,
    unmanagedNodes,
    optedOutRegisterRefs,
    aedNodeCount: aedNodes.length,
    issues,
  };
};

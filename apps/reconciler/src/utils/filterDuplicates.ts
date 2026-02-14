import type { OverpassNode } from "@repo/overpass-sdk";

export interface DuplicateRefGroup {
  ref: string;
  nodeIds: number[];
  nodes: OverpassNode[];
}

export interface DuplicateFilterResult {
  uniqueNodes: OverpassNode[];
  duplicates: DuplicateRefGroup[];
}

// Accept managed AED nodes and split them into unique refs and duplicate ref groups.
export const filterDuplicates = (
  managedAedNodes: OverpassNode[],
): DuplicateFilterResult => {
  const nodesByRef = new Map<string, OverpassNode[]>();

  for (const node of managedAedNodes) {
    const ref = node.tags?.["ref:hjertestarterregister"]?.trim();
    if (!ref) {
      console.warn(
        `Node ${node.id} does not have ref:hjertestarterregister tag`,
      );
      continue;
    }

    const existing = nodesByRef.get(ref);
    if (existing) {
      existing.push(node);
      continue;
    }

    nodesByRef.set(ref, [node]);
  }

  const uniqueNodes: OverpassNode[] = [];
  const duplicates: DuplicateRefGroup[] = [];

  for (const [ref, nodes] of nodesByRef.entries()) {
    if (nodes.length === 1) {
      const [uniqueNode] = nodes;
      if (uniqueNode) uniqueNodes.push(uniqueNode);
      continue;
    }

    duplicates.push({
      ref,
      nodeIds: nodes.map((node) => node.id).sort((left, right) => left - right),
      nodes: [...nodes].sort((left, right) => left.id - right.id),
    });
  }

  if (duplicates.length > 0) {
    console.error(
      `Found duplicate ref:hjertestarterregister values: ${duplicates.map((duplicate) => duplicate.ref).join(", ")}`,
    );
  }

  return {
    uniqueNodes,
    duplicates: duplicates.sort((left, right) =>
      left.ref.localeCompare(right.ref),
    ),
  };
};

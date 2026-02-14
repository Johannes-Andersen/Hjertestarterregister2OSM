import type { OverpassElements } from "@repo/overpass-sdk";

export const buildNodeElementIndex = (elements: OverpassElements[]) => {
  const indexByNodeId = new Map<number, number>();

  for (const [index, element] of elements.entries()) {
    if (element.type !== "node") continue;
    indexByNodeId.set(element.id, index);
  }

  return indexByNodeId;
};

export const pruneDeletedNodesFromElements = ({
  elements,
  deletedNodeIds,
}: {
  elements: OverpassElements[];
  deletedNodeIds: Set<number>;
}) => {
  if (!deletedNodeIds.size) return;

  for (let index = elements.length - 1; index >= 0; index--) {
    const element = elements[index];
    if (!element || element.type !== "node") continue;
    if (!deletedNodeIds.has(element.id)) continue;
    elements.splice(index, 1);
  }
};

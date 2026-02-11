import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";

export const isOverpassNode = (
  node: OverpassElements,
): node is OverpassNode => {
  if (node.type !== "node") return false;

  return Boolean(node.lat && node.lon);
};

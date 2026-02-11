import type { OverpassNode } from "@repo/overpass-sdk";

export const isManagedAed = (aedNode: OverpassNode) => {
  const refNoHjertestarterregister =
    aedNode.tags?.["ref:hjertestarterregister"];
  if (refNoHjertestarterregister) return true;

  return false;
};

import type { OverpassNode } from "@repo/overpass-sdk";

export const isManagedAed = (aedNode: OverpassNode): boolean =>
  Boolean(aedNode.tags?.["ref:hjertestarterregister"]?.trim());

import type { OverpassNode } from "@repo/overpass-sdk";

const optOutTag = "note";

export const isNodeOptedOut = (node: OverpassNode): boolean =>
  Object.hasOwn(node.tags ?? {}, optOutTag);

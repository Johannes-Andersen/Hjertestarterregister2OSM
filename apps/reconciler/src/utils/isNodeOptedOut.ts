import type { OverpassNode } from "@repo/overpass-sdk";

const optOutTag = "note";
const isFixmeTag = "fixme";

export const isNodeOptedOut = (node: OverpassNode): boolean =>
  Boolean(node.tags?.[optOutTag] || node.tags?.[isFixmeTag]);

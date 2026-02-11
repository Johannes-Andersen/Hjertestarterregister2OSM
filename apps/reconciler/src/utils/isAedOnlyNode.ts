import type { OsmNode } from "@repo/osm-sdk";

const allowedStandaloneAedTagKeys = new Set([
  "emergency",
  "name",
  "opening_hours",
  "access",
  "phone",
  "emergency:phone",
  "defibrillator:location",
  "defibrillator:code",
  "indoor",
  "locked",
  "level",
  "description",
  "manufacturer",
  "model",
  "defibrillator:cabinet",
  "defibrillator:cabinet:manufacturer",
  "defibrillator:cabinet:colour",
  "ref:hjertestarterregister",
]);

export const isAedOnlyNode = (node: Pick<OsmNode, "tags">) => {
  const tags = node.tags;
  if (!tags) return false;

  if (!tags.emergency) return false;
  if (!["defibrillator", "aed"].includes(tags.emergency)) return false;

  return Object.keys(tags).every((key) => allowedStandaloneAedTagKeys.has(key));
};

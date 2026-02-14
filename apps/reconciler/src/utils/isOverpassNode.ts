import type { OverpassElements, OverpassNode } from "@repo/overpass-sdk";

export const isOverpassNode = (
  element: OverpassElements,
): element is OverpassNode =>
  element.type === "node" &&
  Number.isFinite(element.lat) &&
  Number.isFinite(element.lon);

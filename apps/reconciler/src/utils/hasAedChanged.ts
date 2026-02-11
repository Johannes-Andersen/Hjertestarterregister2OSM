import type { OverpassNode } from "@repo/overpass-sdk";
import type { RegisterAed } from "../register/type.ts";
import type { AedTags } from "../types/aedTags.ts";
import { coordinateDistance } from "./coordinateDistance.ts";

interface Arguments {
  oldNode: OverpassNode;
  aedInfo: RegisterAed;
  expectedTags: Partial<AedTags>;
  locationDistanceMeters: number;
}

export const hasAedChanged = ({
  oldNode,
  aedInfo,
  expectedTags,
  locationDistanceMeters,
}: Arguments) => {
  for (const [key, value] of Object.entries(expectedTags)) {
    if (oldNode.tags?.[key] !== value) return true;
  }

  if (
    Number.isFinite(aedInfo.SITE_LATITUDE) &&
    Number.isFinite(aedInfo.SITE_LONGITUDE)
  ) {
    const distance = coordinateDistance(
      { lat: oldNode.lat, lon: oldNode.lon },
      { lat: aedInfo.SITE_LATITUDE, lon: aedInfo.SITE_LONGITUDE },
    );
    if (distance > locationDistanceMeters) return true;
  }

  return false;
};

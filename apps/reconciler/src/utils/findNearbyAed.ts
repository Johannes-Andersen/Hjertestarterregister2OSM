import type { OverpassElements } from "@repo/overpass-sdk";
import { coordinateDistance } from "./coordinateDistance.ts";

interface Coordinate {
  lat: number;
  lon: number;
}

interface Arguments {
  coordinate: Coordinate;
  elements: OverpassElements[];
  maxDistanceMeters: number;
}

interface NearbyElement {
  element: OverpassElements;
  distanceMeters: number;
}

const getElementCoordinates = (element: OverpassElements): Coordinate[] => {
  if (element.type === "node") return [{ lat: element.lat, lon: element.lon }];

  const coordinates: Coordinate[] = [];

  if (
    "geometry" in element &&
    Array.isArray(element.geometry) &&
    element.geometry.length > 0
  ) {
    coordinates.push(...element.geometry);
  }

  if ("center" in element && element.center) {
    coordinates.push({ lat: element.center.lat, lon: element.center.lon });
  }

  return coordinates;
};

export const findNearbyAed = ({
  coordinate,
  elements,
  maxDistanceMeters,
}: Arguments): NearbyElement | null => {
  let closest: NearbyElement | null = null;

  for (const element of elements) {
    const coordinates = getElementCoordinates(element);
    if (!coordinates.length) continue;

    for (const currentCoordinate of coordinates) {
      const distance = coordinateDistance(coordinate, currentCoordinate);

      if (distance > maxDistanceMeters) continue;

      if (!closest || distance < closest.distanceMeters) {
        closest = { element, distanceMeters: distance };
      }
    }
  }

  return closest;
};

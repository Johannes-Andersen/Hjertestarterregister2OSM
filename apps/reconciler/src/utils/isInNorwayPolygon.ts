import { norwayBoundary } from "../data/norwayBoundary.ts";

type Position = [number, number];
type LinearRing = Position[];
type Polygon = LinearRing[];
type MultiPolygon = Polygon[];

const epsilon = 1e-10;

const isPointOnSegment = ({
  point,
  start,
  end,
}: {
  point: Position;
  start: Position;
  end: Position;
}) => {
  const [px, py] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;

  const cross = (py - y1) * (x2 - x1) - (px - x1) * (y2 - y1);
  if (Math.abs(cross) > epsilon) return false;

  const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
  return dot <= epsilon;
};

const isPointInRing = ({
  point,
  ring,
}: {
  point: Position;
  ring: LinearRing;
}) => {
  let inside = false;

  for (
    let currentIndex = 0, previousIndex = ring.length - 1;
    currentIndex < ring.length;
    previousIndex = currentIndex++
  ) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    if (!current || !previous) continue;

    if (
      isPointOnSegment({
        point,
        start: previous,
        end: current,
      })
    ) {
      return true;
    }

    const [x, y] = point;
    const [x1, y1] = previous;
    const [x2, y2] = current;

    const intersects =
      y1 > y !== y2 > y &&
      x < ((x2 - x1) * (y - y1)) / (y2 - y1 + epsilon) + x1;

    if (intersects) inside = !inside;
  }

  return inside;
};

const isPointInPolygon = ({
  point,
  polygon,
}: {
  point: Position;
  polygon: Polygon;
}) => {
  const [outerRing, ...innerRings] = polygon;
  if (!outerRing) return false;

  if (!isPointInRing({ point, ring: outerRing })) return false;

  for (const innerRing of innerRings) {
    if (isPointInRing({ point, ring: innerRing })) return false;
  }

  return true;
};

const norwayMultiPolygon: MultiPolygon =
  norwayBoundary.coordinates as unknown as MultiPolygon;

export const isInNorwayPolygon = ({
  lat,
  lon,
}: {
  lat: number;
  lon: number;
}) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  const point: Position = [lon, lat];

  for (const polygon of norwayMultiPolygon) {
    if (
      isPointInPolygon({
        point,
        polygon,
      })
    ) {
      return true;
    }
  }

  return false;
};

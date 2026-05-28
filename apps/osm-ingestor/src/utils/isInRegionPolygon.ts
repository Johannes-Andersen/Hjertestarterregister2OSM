import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeEnv } from "../config.ts";

type Position = [number, number];
type LinearRing = Position[];
type Polygon = LinearRing[];

interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: Polygon;
}

interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: Polygon[];
}

interface GeoJsonFeature {
  type: "Feature";
  geometry?: GeoJsonPolygon | GeoJsonMultiPolygon | { type: string } | null;
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

const resolveRegionFilterPath = (filePath: string): string =>
  isAbsolute(filePath) ? filePath : join(appRoot, filePath);

const loadRegionPolygons = (filePath: string): Polygon[] => {
  const resolved = resolveRegionFilterPath(filePath);
  const raw = readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw) as GeoJsonFeatureCollection;

  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(
      `Region filter at ${resolved} is not a GeoJSON FeatureCollection.`,
    );
  }

  const polygons: Polygon[] = [];

  for (const feature of parsed.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;

    if (geometry.type === "Polygon") {
      polygons.push((geometry as GeoJsonPolygon).coordinates);
    } else if (geometry.type === "MultiPolygon") {
      polygons.push(...(geometry as GeoJsonMultiPolygon).coordinates);
    }
  }

  if (polygons.length === 0) {
    throw new Error(
      `Region filter at ${resolved} contains no Polygon/MultiPolygon geometries.`,
    );
  }

  return polygons;
};

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

const regionPolygons = loadRegionPolygons(
  runtimeEnv.OSM_REGION_FILTER_FILE_PATH,
);

export const isInRegionPolygon = ({
  lat,
  lon,
}: {
  lat: number;
  lon: number;
}) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

  const point: Position = [lon, lat];

  for (const polygon of regionPolygons) {
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

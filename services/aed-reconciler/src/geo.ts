const EARTH_RADIUS_M = 6_371_000;

export interface LatLon {
  lat: number;
  lon: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in meters between two coordinates. */
export const distanceMeters = (a: LatLon, b: LatLon): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
};

export interface BoundingBox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/** A latitude/longitude box that fully contains a circle of `meters` radius. */
export const boundingBox = (center: LatLon, meters: number): BoundingBox => {
  const latDelta = (meters / EARTH_RADIUS_M) * (180 / Math.PI);
  const lonDelta = latDelta / Math.max(Math.cos(toRadians(center.lat)), 1e-12);
  return {
    latMin: center.lat - latDelta,
    latMax: center.lat + latDelta,
    lonMin: center.lon - lonDelta,
    lonMax: center.lon + lonDelta,
  };
};

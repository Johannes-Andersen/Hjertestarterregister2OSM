type Coordinate = { lat: number; lon: number };

// Degrees to radians
const toRad = (value: number) => (value * Math.PI) / 180;

export const coordinateDistance = (coord1: Coordinate, coord2: Coordinate) => {
  const R = 6371e3; // Earth's radius in meters

  const dLat = toRad(coord2.lat - coord1.lat);
  const dLon = toRad(coord2.lon - coord1.lon);

  const lat1 = toRad(coord1.lat);
  const lat2 = toRad(coord2.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

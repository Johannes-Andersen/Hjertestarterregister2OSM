import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { REF_TAG } from "./config.ts";
import { db } from "./db/index.ts";
import { type OsmTags, osmAed, osmAedHistory } from "./db/schema.ts";
import { boundingBox, distanceMeters, type LatLon } from "./geo.ts";

export interface OsmAedNode {
  elementId: number;
  latitude: number;
  longitude: number;
  version: number | null;
  tags: OsmTags;
}

const columns = {
  elementId: true,
  latitude: true,
  longitude: true,
  version: true,
  tags: true,
} as const;

/** Live (non-deleted) nodes carrying `ref:hjertestarterregister = <assetGuid>`. */
export const findByRef = async (ref: string): Promise<OsmAedNode[]> =>
  db.query.osmAed.findMany({
    columns,
    where: and(
      eq(osmAed.elementType, "node"),
      isNull(osmAed.deletedAt),
      sql`${osmAed.tags} ->> ${REF_TAG} = ${ref}`,
    ),
  });

/**
 * Live AED nodes without a registry ref (community-added, "unmanaged") within
 * `meters` of a point, nearest first.
 */
export const findNearbyUnmanaged = async (
  center: LatLon,
  meters: number,
): Promise<Array<OsmAedNode & { distance: number }>> => {
  const box = boundingBox(center, meters);
  const rows = await db.query.osmAed.findMany({
    columns,
    where: and(
      eq(osmAed.elementType, "node"),
      isNull(osmAed.deletedAt),
      sql`${osmAed.tags} ->> 'emergency' = 'defibrillator'`,
      sql`(${osmAed.tags} ->> ${REF_TAG}) IS NULL`,
      sql`${osmAed.latitude} BETWEEN ${box.latMin} AND ${box.latMax}`,
      sql`${osmAed.longitude} BETWEEN ${box.lonMin} AND ${box.lonMax}`,
    ),
  });

  return rows
    .map((row) => ({
      ...row,
      distance: distanceMeters(center, {
        lat: row.latitude,
        lon: row.longitude,
      }),
    }))
    .filter((row) => row.distance <= meters)
    .sort((a, b) => a.distance - b.distance);
};

/** Username that most recently changed the stored coordinates of a node. */
export const findLocationOwner = async (
  nodeId: number,
): Promise<string | null> => {
  const history = await db.query.osmAedHistory.findMany({
    where: and(
      eq(osmAedHistory.elementType, "node"),
      eq(osmAedHistory.elementId, nodeId),
      eq(osmAedHistory.isDeleted, false),
    ),
    columns: {
      latitude: true,
      longitude: true,
      userName: true,
    },
    orderBy: asc(osmAedHistory.version),
  });
  if (history.length === 0) return null;

  let owner = history[0]?.userName ?? null;
  for (let index = 1; index < history.length; index++) {
    const previous = history[index - 1];
    const current = history[index];
    if (!previous || !current) continue;
    if (
      current.latitude !== previous.latitude ||
      current.longitude !== previous.longitude
    ) {
      owner = current.userName;
    }
  }
  return owner;
};

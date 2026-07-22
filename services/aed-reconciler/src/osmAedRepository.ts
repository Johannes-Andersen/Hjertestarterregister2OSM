import { and, eq, isNull, sql } from "drizzle-orm";
import { REF_TAG } from "./config.ts";
import { db } from "./db/index.ts";
import { type OsmTags, osmAed } from "./db/schema.ts";
import { boundingBox, distanceMeters, type LatLon } from "./geo.ts";

export interface OsmAedNode {
  elementId: number;
  latitude: number;
  longitude: number;
  version: number | null;
  tags: OsmTags;
}

const selection = {
  elementId: osmAed.elementId,
  latitude: osmAed.latitude,
  longitude: osmAed.longitude,
  version: osmAed.version,
  tags: osmAed.tags,
};

/** Live (non-deleted) nodes carrying `ref:hjertestarterregister = <assetGuid>`. */
export const findByRef = async (ref: string): Promise<OsmAedNode[]> =>
  db
    .select(selection)
    .from(osmAed)
    .where(
      and(
        eq(osmAed.elementType, "node"),
        isNull(osmAed.deletedAt),
        sql`${osmAed.tags} ->> ${REF_TAG} = ${ref}`,
      ),
    );

/**
 * Live AED nodes without a registry ref (community-added, "unmanaged") within
 * `meters` of a point, nearest first.
 */
export const findNearbyUnmanaged = async (
  center: LatLon,
  meters: number,
): Promise<Array<OsmAedNode & { distance: number }>> => {
  const box = boundingBox(center, meters);
  const rows = await db
    .select(selection)
    .from(osmAed)
    .where(
      and(
        eq(osmAed.elementType, "node"),
        isNull(osmAed.deletedAt),
        sql`${osmAed.tags} ->> 'emergency' = 'defibrillator'`,
        sql`(${osmAed.tags} ->> ${REF_TAG}) IS NULL`,
        sql`${osmAed.latitude} BETWEEN ${box.latMin} AND ${box.latMax}`,
        sql`${osmAed.longitude} BETWEEN ${box.lonMin} AND ${box.lonMax}`,
      ),
    );

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

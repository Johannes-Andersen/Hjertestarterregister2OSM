import { isInRegionPolygon } from "./isInRegionPolygon.ts";

export type OsmElementType = "node" | "way" | "relation";

export interface OsmAedKey {
  element_type: OsmElementType;
  element_id: number;
}

export interface OsmElementInfo {
  version?: number;
  changeset?: number;
  uid?: number;
  user?: string;
  timestamp?: Date | number | string;
}

export interface OsmNodeLike {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
  info?: OsmElementInfo;
}

export interface OsmAedRow extends OsmAedKey {
  latitude: number;
  longitude: number;
  version: number | null;
  changeset: number | null;
  uid: number | null;
  user_name: string | null;
  osm_timestamp: Date | null;
  tags: Record<string, string>;
}

const toNullableInteger = (value: unknown): number | null =>
  Number.isInteger(value) ? (value as number) : null;

const toNullableDate = (
  value: Date | number | string | undefined,
): Date | null => {
  if (value === undefined) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
};

export const hasAedTags = (
  tags: Record<string, string> | undefined,
): tags is Record<string, string> => {
  const emergency = tags?.emergency?.trim().toLowerCase();
  return emergency === "defibrillator";
};

export const isNorwegianAedNode = (node: OsmNodeLike): boolean =>
  hasAedTags(node.tags) &&
  isInRegionPolygon({
    lat: node.lat,
    lon: node.lon,
  });

export const toOsmAedKey = (node: Pick<OsmNodeLike, "id">): OsmAedKey => ({
  element_type: "node",
  element_id: node.id,
});

export const transformOsmNodeAedForStorage = (node: OsmNodeLike): OsmAedRow => {
  if (!hasAedTags(node.tags)) {
    throw new Error(`OSM node ${node.id} is missing AED tags.`);
  }

  return {
    element_type: "node",
    element_id: node.id,
    latitude: node.lat,
    longitude: node.lon,
    version: toNullableInteger(node.info?.version),
    changeset: toNullableInteger(node.info?.changeset),
    uid: toNullableInteger(node.info?.uid),
    user_name: node.info?.user?.trim() || null,
    osm_timestamp: toNullableDate(node.info?.timestamp),
    tags: node.tags,
  };
};

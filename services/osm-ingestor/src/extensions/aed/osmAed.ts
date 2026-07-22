import type { OsmElementKey, OsmNodeLike } from "../../types/osm.ts";

export type OsmAedKey = OsmElementKey;

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

export interface OsmAedRemovalRow extends OsmAedKey {
  latitude: number | null;
  longitude: number | null;
  version: number | null;
  changeset: number | null;
  uid: number | null;
  user_name: string | null;
  osm_timestamp: Date | null;
  tags: Record<string, string>;
  is_aed: boolean;
  is_deleted: boolean;
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

export const transformOsmNodeRemovalForStorage = ({
  node,
  isDeleted,
}: {
  node: OsmNodeLike;
  isDeleted: boolean;
}): OsmAedRemovalRow => ({
  element_type: "node",
  element_id: node.id,
  latitude: Number.isFinite(node.lat) ? node.lat : null,
  longitude: Number.isFinite(node.lon) ? node.lon : null,
  version: toNullableInteger(node.info?.version),
  changeset: toNullableInteger(node.info?.changeset),
  uid: toNullableInteger(node.info?.uid),
  user_name: node.info?.user?.trim() || null,
  osm_timestamp: toNullableDate(node.info?.timestamp),
  tags: node.tags ?? {},
  is_aed: hasAedTags(node.tags),
  is_deleted: isDeleted,
});

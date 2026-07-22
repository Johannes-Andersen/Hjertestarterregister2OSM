export type OsmTags = Record<string, string>;

export type OsmChangeAction = "create" | "modify" | "delete";

export interface OsmElementInfo {
  version?: number;
  changeset?: number;
  uid?: number;
  user?: string;
  timestamp?: string | number | Date;
}

/** A node with known coordinates, ready to be stored. */
export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags: OsmTags;
  info: OsmElementInfo;
}

/** A single node entry from a replication change (`.osc`) file. */
export interface OsmNodeChange {
  action: OsmChangeAction;
  id: number;
  lat: number | null;
  lon: number | null;
  tags: OsmTags;
  info: OsmElementInfo;
}

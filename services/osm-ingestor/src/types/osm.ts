export type OsmElementType = "node" | "way" | "relation";

export interface OsmElementKey {
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

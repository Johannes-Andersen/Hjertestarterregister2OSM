import type { HeadersInit } from "undici";

export interface OverpassSdkClientOptions {
  apiUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  userAgent?: string;
}

export interface OverpassQueryOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

export type OverpassElements =
  | OverpassNode
  | OverpassWay
  | OverpassRelation
  | OverpassArea
  | OverpassTimeline
  | OverpassCount;

export interface OverpassResponse {
  version: number;
  generator: string;
  osm3s: {
    timestamp_osm_base: string;
    timestamp_areas_base?: string;
    copyright: string;
  };
  elements: OverpassElements[];
}

export interface OverpassElement {
  type: "node" | "way" | "relation" | "area" | "timeline" | "count";
  id: number;
}

export interface OverpassOsmElement extends OverpassElement {
  type: "node" | "way" | "relation";
  timestamp?: string;
  version?: number;
  changeset?: number;
  user?: string;
  uid?: number;
  tags?: Record<string, string>;
}

export interface OverpassNode extends OverpassOsmElement {
  type: "node";
  lat: number;
  lon: number;
}

export interface OverpassWay extends OverpassOsmElement {
  type: "way";
  nodes: number[];
  center?: OverpassPointGeo;
  bounds?: OverpassBbox;
  geometry?: OverpassPointGeo[];
}

export interface OverpassRelation extends OverpassOsmElement {
  type: "relation";
  members: OverpassRelationMember[];
  center?: OverpassPointGeo;
  bounds?: OverpassBbox;
  geometry?: OverpassPointGeo[];
}

export interface OverpassRelationMember {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
  lon?: number;
  lat?: number;
  geometry?: OverpassPointGeo[];
}

export interface OverpassArea extends OverpassElement {
  type: "area";
  tags: Record<string, string>;
}

export interface OverpassTimeline extends OverpassElement {
  type: "timeline";
  tags: {
    reftype: string;
    ref: string;
    refversion: string;
    created: string;
    expired?: string;
  };
}

export interface OverpassCount extends OverpassElement {
  type: "count";
  tags: {
    nodes: string;
    ways: string;
    relations: string;
    total: string;
  };
}

export interface OverpassPointGeo {
  lat: number;
  lon: number;
}

export interface OverpassBbox {
  minlat: number;
  minlon: number;
  maxlat: number;
  maxlon: number;
}

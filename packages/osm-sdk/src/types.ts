import type { Tags, UploadResult } from "osm-api";

export type { OsmFeature, OsmNode, OsmRelation, OsmWay, Tags } from "osm-api";

export interface OsmSdkClientOptions {
  apiUrl?: string;
  bearerToken?: string;
  userAgent?: string;
  changesetTags?: Tags;
}

export interface PlannedNode {
  id: number;
  lat: number;
  lon: number;
  version?: number;
  tags: Record<string, string | undefined>;
}

export interface PlannedCreateChange {
  node: PlannedNode;
}

export interface PlannedModifyChange {
  before: PlannedNode;
  after: PlannedNode;
  tagUpdates: Record<string, string | undefined>;
}

export interface PlannedDeleteChange {
  node: PlannedNode;
}

export interface ChangePlan {
  create: PlannedCreateChange[];
  modify: PlannedModifyChange[];
  delete: PlannedDeleteChange[];
}

export interface ApplyBatchedChangesArguments {
  changePlan: ChangePlan;
  changesetTags?: Tags;
  commentSubject?: string;
}

export interface AppliedBatch {
  changesets: UploadResult;
  createCount: number;
  modifyCount: number;
  deleteCount: number;
}

export type SyncRunMode = "dry-run" | "live";

export type SyncRunStatus = "running" | "success" | "failed";

export type SyncIssueSeverity = "warning" | "error";

export type SyncIssueType =
  | "osm_node_missing_ref"
  | "osm_duplicate_register_ref"
  | "registry_duplicate_register_ref"
  | "skipped_create_nearby"
  | "skipped_delete_not_aed_only"
  | "orphan_osm_register_ref";

export interface SyncRunMetrics {
  registryAeds: number;
  osmAeds: number;
  linkedAeds: number;
  updated: number;
  created: number;
  deleted: number;
  skippedCreateNearby: number;
  skippedDeleteNotAedOnly: number;
  unchanged: number;
}

export interface NewSyncIssue {
  type: SyncIssueType;
  severity: SyncIssueSeverity;
  message: string;
  registerRef?: string;
  osmNodeId?: number;
  details?: Record<string, unknown>;
}

export interface SyncStoreClientOptions {
  connectionString: string;
  maxConnections?: number;
  connectTimeoutSeconds?: number;
  idleTimeoutSeconds?: number;
}

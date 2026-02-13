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

export interface SyncRunCounters {
  updated: number;
  created: number;
  deleted: number;
  skippedCreateNearby: number;
  skippedDeleteNotAedOnly: number;
  unchanged: number;
}

export interface SyncRunMetrics extends SyncRunCounters {
  registryAeds: number;
  osmAeds: number;
  managedOsmAeds: number;
  uniqueManagedOsmAeds: number;
  linkedAeds: number;
}

export interface SyncRunRecord extends SyncRunMetrics {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: SyncRunStatus;
  mode: SyncRunMode;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncRunIssueRecord {
  id: string;
  runId: string;
  issueType: SyncIssueType;
  severity: SyncIssueSeverity;
  message: string;
  registerRef: string | null;
  osmNodeId: number | null;
  details: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncOverviewStats {
  latestRun: SyncRunRecord | null;
  latestSuccessfulRun: SyncRunRecord | null;
  openIssueCount: number;
  totalIssueCount: number;
}

export interface SyncIssueTypeCount {
  issueType: SyncIssueType;
  count: number;
}

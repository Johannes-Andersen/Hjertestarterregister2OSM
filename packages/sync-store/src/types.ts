export type SyncRunMode = "dry-run" | "live";

export type SyncRunStatus = "running" | "success" | "failed";

export type SyncIssueSeverity = "warning" | "error";

export type SyncIssueType =
  | "osm_node_missing_ref"
  | "osm_duplicate_register_ref"
  | "skipped_create_nearby"
  | "skipped_delete_not_aed_only";

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
  maxConnections?: number;
  connectionString: string;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
  ssl?: "require" | "allow" | "prefer" | "verify-full" | boolean;
}

export interface SyncRunCounters {
  updated: number;
  created: number;
  deleted: number;
  skippedCreateNearby: number;
  skippedDeleteNotAedOnly: number;
  unchanged: number;
}

export interface SyncRunRecord extends SyncRunCounters {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: SyncRunStatus;
  mode: SyncRunMode;
  errorMessage: string | null;
  linkedAeds: number;
}

export interface SyncRunListItem extends SyncRunCounters {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: SyncRunStatus;
  mode: SyncRunMode;
}

export interface SyncOverviewRunData {
  finishedAt: Date | null;
  status: SyncRunStatus;
  registryAeds: number;
  osmAeds: number;
  linkedAeds: number;
}

export interface SyncRunIssueListItem {
  runId: string;
  issueType: SyncIssueType;
  severity: SyncIssueSeverity;
  message: string;
  registerRef: string | null;
  osmNodeId: number | null;
  createdAt: Date;
}

export interface SyncOverviewStats {
  latestRun: SyncOverviewRunData | null;
  latestSuccessfulRun: SyncOverviewRunData | null;
  openIssueCount: number;
  totalIssueCount: number;
}

export interface SyncIssueTypeCount {
  issueType: SyncIssueType;
  count: number;
}

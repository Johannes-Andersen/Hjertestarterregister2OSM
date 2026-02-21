export type SyncRunMode = "dry-run" | "live";

export type SyncRunStatus = "running" | "success" | "failed";

export type SyncIssueSeverity = "warning" | "error";

export type SyncIssueType =
  | "register_aed_outside_norway"
  | "register_missing_required_data"
  | "osm_not_a_node"
  | "osm_node_note_opt_out"
  | "managed_node_location_within_tolerance"
  | "skipped_create_nearby"
  | "skipped_delete_not_aed_only";

export type SyncOsmElementType = "node" | "way" | "relation";

export interface SyncRunMetrics {
  registryAeds: number;
  osmAeds: number;
  linkedAeds: number;
  updated: number;
  created: number;
  deleted: number;
}

export interface NewSyncIssue {
  type: SyncIssueType;
  severity: SyncIssueSeverity;
  message: string;
  registerRef?: string;
  osmNodeId?: number;
  details?: Record<string, string | number | boolean | null | undefined>;
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
  osmElementType: SyncOsmElementType | null;
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

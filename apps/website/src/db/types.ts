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

// Full record - used only for single run detail page
export interface SyncRunRecord extends SyncRunCounters {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: SyncRunStatus;
  mode: SyncRunMode;
  errorMessage: string | null;
  linkedAeds: number;
}

// Lightweight record for run listings (tables)
export interface SyncRunListItem extends SyncRunCounters {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: SyncRunStatus;
  mode: SyncRunMode;
}

// Minimal data needed for overview stats cards
export interface SyncOverviewRunData {
  finishedAt: Date | null;
  status: SyncRunStatus;
  registryAeds: number;
  osmAeds: number;
  linkedAeds: number;
}

// Lightweight issue record for listings (excludes unused 'details' JSONB)
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

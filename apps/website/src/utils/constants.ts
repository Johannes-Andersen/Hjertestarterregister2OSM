import type { SyncIssueType } from "@repo/sync-store";

export const issueTypeLabels: Record<SyncIssueType, string> = {
  osm_node_missing_ref: "OSM node missing register ref",
  osm_duplicate_register_ref: "Duplicate register ref in OSM",
  skipped_create_nearby: "Skipped create due to nearby node",
  skipped_delete_not_aed_only: "Skipped delete due to non-AED tags",
};

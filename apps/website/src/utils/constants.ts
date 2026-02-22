import type { SyncIssueType } from "@repo/sync-store";

export const issueTypeLabels: Record<SyncIssueType, string> = {
  register_aed_outside_norway: "Register AED outside Norway polygon",
  register_missing_required_data: "Register AED missing required data",
  osm_node_note_opt_out: "OSM node opted out via note or fixme tag",
  osm_not_a_node: "OSM element is not a node",
  managed_node_location_within_tolerance:
    "Managed node moved in OSM (kept existing location)",
  skipped_create_nearby: "Skipped create due to nearby node",
  skipped_delete_not_aed_only: "Skipped delete due to non-AED tags",
};

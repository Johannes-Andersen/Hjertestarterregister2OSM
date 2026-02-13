import type { Sql } from "postgres";
import type {
  SyncIssueTypeCount,
  SyncOverviewRunData,
  SyncOverviewStats,
  SyncRunIssueListItem,
  SyncRunListItem,
  SyncRunRecord,
} from "./types";

type WebsiteSql = Sql<Record<string, never>>;

// Full column selection - only used for single run detail view
const selectSyncRunFullColumns = (sql: WebsiteSql) => sql`
  id,
  started_at as "startedAt",
  finished_at as "finishedAt",
  status,
  mode,
  error_message as "errorMessage",
  linked_aeds_count as "linkedAeds",
  updated_count as "updated",
  created_count as "created",
  deleted_count as "deleted",
  skipped_create_nearby_count as "skippedCreateNearby",
  skipped_delete_not_aed_only_count as "skippedDeleteNotAedOnly",
  unchanged_count as "unchanged"
`;

// Minimal columns for run listings (index + runs page tables)
const selectSyncRunListColumns = (sql: WebsiteSql) => sql`
  id,
  started_at as "startedAt",
  finished_at as "finishedAt",
  status,
  mode,
  updated_count as "updated",
  created_count as "created",
  deleted_count as "deleted",
  skipped_create_nearby_count as "skippedCreateNearby",
  skipped_delete_not_aed_only_count as "skippedDeleteNotAedOnly",
  unchanged_count as "unchanged"
`;

// Minimal columns for overview stats (dashboard summary cards)
const selectSyncRunOverviewColumns = (sql: WebsiteSql) => sql`
  finished_at as "finishedAt",
  status,
  registry_aeds_count as "registryAeds",
  osm_aeds_count as "osmAeds",
  linked_aeds_count as "linkedAeds"
`;

// Minimal columns for issue listings (excludes unused 'details' JSONB)
const selectIssueListColumns = (sql: WebsiteSql) => sql`
  run_id as "runId",
  issue_type as "issueType",
  severity,
  message,
  register_ref as "registerRef",
  osm_node_id as "osmNodeId",
  created_at as "createdAt"
`;

export const getSyncRunById = async (
  sql: WebsiteSql,
  runId: string,
): Promise<SyncRunRecord | null> => {
  const [row] = await sql<SyncRunRecord[]>`
    SELECT ${selectSyncRunFullColumns(sql)}
    FROM sync_runs
    WHERE id = ${runId}
    LIMIT 1
  `;

  return row ?? null;
};

export const listSyncRunIssues = async (
  sql: WebsiteSql,
  options: { runId?: string; limit?: number } = {},
): Promise<SyncRunIssueListItem[]> => {
  const limit = options.limit ?? 400;

  if (options.runId) {
    return sql<SyncRunIssueListItem[]>`
      SELECT ${selectIssueListColumns(sql)}
      FROM sync_run_issues
      WHERE run_id = ${options.runId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  return sql<SyncRunIssueListItem[]>`
    SELECT ${selectIssueListColumns(sql)}
    FROM sync_run_issues
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
};

export const listRecentSyncRuns = async (
  sql: WebsiteSql,
  limit = 30,
): Promise<SyncRunListItem[]> => {
  const normalizedLimit = Math.min(Math.max(1, limit), 200);

  return sql<SyncRunListItem[]>`
    SELECT ${selectSyncRunListColumns(sql)}
    FROM sync_runs
    ORDER BY started_at DESC
    LIMIT ${normalizedLimit}
  `;
};

export const listIssueTypeCounts = async (
  sql: WebsiteSql,
): Promise<SyncIssueTypeCount[]> => {
  return sql<SyncIssueTypeCount[]>`
    SELECT
      issue_type as "issueType",
      COUNT(*)::int as "count"
    FROM sync_run_issues
    GROUP BY issue_type
    ORDER BY "count" DESC, "issueType" ASC
  `;
};

export const getSyncOverviewStats = async (
  sql: WebsiteSql,
): Promise<SyncOverviewStats> => {
  const [latestRun, latestSuccessfulRun, issueTotals] = await Promise.all([
    sql<SyncOverviewRunData[]>`
      SELECT ${selectSyncRunOverviewColumns(sql)}
      FROM sync_runs
      ORDER BY started_at DESC
      LIMIT 1
    `,
    sql<SyncOverviewRunData[]>`
      SELECT ${selectSyncRunOverviewColumns(sql)}
      FROM sync_runs
      WHERE status = 'success'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `,
    sql<{ issueCount: number }[]>`
      SELECT COUNT(*)::int as "issueCount"
      FROM sync_run_issues
    `,
  ]);

  const currentIssueCount = issueTotals[0]?.issueCount ?? 0;

  return {
    latestRun: latestRun[0] ?? null,
    latestSuccessfulRun: latestSuccessfulRun[0] ?? null,
    openIssueCount: currentIssueCount,
    totalIssueCount: currentIssueCount,
  };
};
